/**
 * Regions are visual overlays on the waveform that can be used to mark segments of audio.
 * Regions can be clicked on, dragged and resized.
 * You can set the color and content of each region, as well as their HTML content.
 * Regions can be open-ended, meaning they have no end time. A region with no end time
 * extends to the end of the audio or the start of the next region.
 */

import { BasePlugin } from "wavesurfer.js/dist/base-plugin.js";
import { BasePluginEvents } from "wavesurfer.js/dist/base-plugin.js";
import EventEmitter from "wavesurfer.js/dist/event-emitter.js";
import createElement from "wavesurfer.js/dist/dom.js";
import { groupBy, sortBy } from "lodash-es";
import { listenForDrags } from "./dragStream";
import { listenForMarquee, MarqueeArea } from "./marquee";

// Every drag in progress, in any plugin instance.
const activeDrags = new Set<object>();

/**
 * Whether a region or a display band is being dragged.
 */
export function isDragging(): boolean {
  return activeDrags.size > 0;
}

export function makeDraggable(
  element: HTMLElement,
  onDrag: (dx: number, dy: number, x: number, y: number) => void,
  onStart?: (x: number, y: number) => void,
  onEnd?: (x: number, y: number) => void,
  threshold?: number,
): () => void {
  const drag = {};
  const stopListening = listenForDrags(
    element,
    {
      onStart: (x, y) => {
        activeDrags.add(drag);
        onStart?.(x, y);
      },
      onMove: onDrag,
      onEnd: (x, y) => {
        activeDrags.delete(drag);
        onEnd?.(x, y);
      },
    },
    { threshold },
  );
  return () => {
    // A drag cut short by removing its element never sends its end.
    activeDrags.delete(drag);
    stopListening();
  };
}

export class OverlapError extends Error {
  constructor(region: Region, otherRegion: Region) {
    super(`Region ${region.id} overlaps with existing region ${otherRegion.id}`);
  }
}

export type RegionsPluginOptions = undefined;

export type RegionsPluginEvents = BasePluginEvents & {
  /** When a region is created */
  "region-created": [region: Region];
  /** When a region is being updated */
  "region-update": [region: Region, side?: "start" | "end"];
  /** When a region is done updating */
  "region-updated": [region: Region];
  /** When a selection of regions is done being dragged together */
  "regions-updated": [regions: Region[]];
  /** When a region is removed */
  "region-removed": [region: Region];
  /** When a region is clicked */
  "region-clicked": [region: Region, e: MouseEvent];
  /** When a region is double-clicked */
  "region-double-clicked": [region: Region, e: MouseEvent];
  /** When the selection changes, with the ids of the selected regions */
  "selection-change": [ids: string[]];
  /** When playback enters a region */
  "region-in": [region: Region];
  /** When playback leaves a region */
  "region-out": [region: Region];
};

export type RegionEvents = {
  /** Before the region is removed */
  remove: [];
  /** When the region's parameters are being updated */
  update: [side?: "start" | "end"];
  /** When dragging or resizing is finished */
  "update-end": [];
  /** When a drag of one of the region's edges begins */
  "resize-start": [side: "start" | "end"];
  /** When a drag of one of the region's edges finishes */
  "resize-end": [];
  /** When a drag of the region's body begins */
  "body-drag-start": [];
  /** While the region's body is being dragged, by a horizontal pixel delta */
  "body-drag": [dx: number];
  /** When a drag of the region's body finishes */
  "body-drag-end": [];
  /** On play */
  play: [];
  /** On mouse click */
  click: [event: MouseEvent];
  /** Double click */
  dblclick: [event: MouseEvent];
  /** Mouse over */
  over: [event: MouseEvent];
  /** Mouse leave */
  leave: [event: MouseEvent];
};

export type RegionParams = {
  /** The id of the region, any string */
  id?: string;
  /** The start position of the region (in seconds) */
  start: number;
  /** The end position of the region (in seconds) */
  end?: number;
  /** Allow/dissallow resizing the region */
  resize?: boolean;
  /** The color of the region (CSS color) */
  color?: string;
  /** Content string */
  content?: string;
  /** Min length when resizing (in seconds) */
  minLength?: number;
  /** Max length when resizing (in seconds) */
  maxLength?: number;
  /** The index of the channel */
  channelIdx?: number;
  /** The number of channels, spread evenly over the track height */
  channelCount?: number;
  /** Paint the region in the selection's colors without selecting it */
  highlighted?: boolean;
  /** Draw the region faded, as one about to be replaced */
  faded?: boolean;
  /** Mark the region as one whose timing a lyric edit changed */
  review?: RegionReview;
  /** Allow/Disallow contenteditable property for content */
  contentEditable?: boolean;
};

// The room left above the first channel and below the last, where an overlay scrollbar is drawn.
const CHANNEL_MARGIN_PX = 12;

// Faint enough to read as a timing on its way out, and still readable with its label.
const FADED_OPACITY = "0.4";

// Keep in sync with --bulma-primary in main.scss.
const SELECTION_COLOR = "#7957d5";

export type RegionReview = "lost" | "moved" | "doubtful";

// A region to review stays visible and clickable however far the waveform is zoomed out.
const REVIEW_MIN_WIDTH_PX = 6;
const REVIEW_MARKER_WIDTH_PX = 2;
const REVIEW_COLORS: Record<RegionReview, string> = {
  lost: "var(--region-review-lost)",
  moved: "var(--region-review-moved)",
  doubtful: "var(--region-review-doubtful)",
};
const REVIEW_TITLES: Record<RegionReview, string> = {
  lost: "Lost its timing in a lyric edit",
  moved: "Timing taken from a replaced word",
  doubtful: "Placed by syncing, which wasn't sure of it",
};

// The label spans two backgrounds: the region's own fill and,
// where it is wider than the region, the bare waveform behind it.
const LABEL_ON_REGION = "var(--region-label-on-fill)";
const LABEL_ON_SELECTION = "white";
const LABEL_ON_WAVEFORM = "var(--region-label-on-waveform)";
// The line across every row at an edge being dragged, for regions and display bands alike.
export const EDGE_LINE_COLOR = `color-mix(in srgb, ${LABEL_ON_WAVEFORM} 45%, transparent)`;
// Knocks the waveform bars out from behind the overhang.
//  Stacked because one shadow is too sheer to cover a bar.
const LABEL_HALO = Array(3).fill("0 0 3px var(--bulma-scheme-main)").join(", ");

const CONTENT_STYLE = {
  padding: "0em 0.2em",
  display: "inline-block",
  // A clipped label's baseline drops to its bottom edge, which would make the region taller than
  // one with a whole label, and a region would change height as its label is clipped.
  verticalAlign: "top",
  whiteSpace: "nowrap",
  overflow: "visible",
  position: "relative",
  zIndex: "1",
};

/**
 * Cut a label off at `maxWidth`. An empty width lets it run on.
 */
function clipLabel(label: HTMLElement, maxWidth: string) {
  Object.assign(label.style, { maxWidth, overflow: maxWidth ? "hidden" : "visible" });
}

function pixelsToSeconds(dx: number, width: number, totalDuration: number): number {
  if (!width || !totalDuration) return 0;
  return (dx / width) * totalDuration;
}

/** The bits of a region that constrain how far a selection may be shifted. */
export type ShiftBounds = {
  start: number;
  end: number;
  isOpenEnded: boolean;
};

/**
 * How far a contiguous run of selected regions may shift before it would cross a region outside the selection.
 * An open-ended neighbor stretches or shrinks instead of blocking,
 * so on that side the limit is its start rather than its end.
 */
export function clampGroupShift(
  bounds: { first: ShiftBounds; last: ShiftBounds; prev?: ShiftBounds; next?: ShiftBounds },
  deltaSeconds: number,
  totalDuration: number,
): number {
  const { first, last, prev, next } = bounds;
  const lowerBound = prev ? (prev.isOpenEnded ? prev.start : prev.end) : 0;
  const upperBound = next ? next.start : totalDuration;
  const trailingEdge = last.isOpenEnded ? last.start : last.end;
  const maxLeft = Math.max(0, first.start - lowerBound);
  const maxRight = Math.max(0, upperBound - trailingEdge);
  return Math.min(maxRight, Math.max(-maxLeft, deltaSeconds));
}

class SingleRegion extends EventEmitter<RegionEvents> implements Region {
  public element: HTMLElement;
  public id: string;
  public start: number;
  public resize: boolean;
  public color: string;
  public content?: HTMLElement;
  private contentOverlay?: HTMLElement;
  private contentOverlayLabel?: HTMLElement;
  public minLength = 0;
  public maxLength = Infinity;
  public channelIdx: number;
  public contentEditable = false;
  public selected = false;
  public highlighted = false;
  public faded = false;
  public review?: RegionReview;
  private reviewMarker?: HTMLElement;
  public isAttached = false;
  public subscriptions: (() => void)[] = [];
  private labelMaxWidth = "";

  private _explicitEnd?: number;
  private resizeDrag?: { side: "start" | "end"; origin: number; dx: number };
  private _nextRegion?: Region;
  private _prevRegion?: Region;

  get end(): number {
    return this._explicitEnd ?? this._nextRegion?.start ?? this.totalDuration;
  }

  set end(time: number | undefined) {
    this._explicitEnd = time;
  }

  get nextRegion() {
    return this._nextRegion;
  }

  set nextRegion(region: Region | undefined) {
    // Clean up old subscription if it exists
    if (this._nextRegion) {
      const index = this.subscriptions.findIndex((sub) =>
        sub.toString().includes("onNeighborMoved"),
      );
      if (index !== -1) {
        this.subscriptions[index]();
        this.subscriptions.splice(index, 1);
      }
    }

    this._nextRegion = region;
    if (region) {
      // Add new subscription
      this.subscriptions.push(region.on("update", () => this.onNeighborMoved("next")));
    }
    this.renderPosition();
  }

  get prevRegion() {
    return this._prevRegion;
  }

  set prevRegion(region: Region | undefined) {
    this._prevRegion = region;
  }

  public get isOpenEnded(): boolean {
    return this._explicitEnd == undefined;
  }

  public get isMarker(): boolean {
    return this.start === this.end;
  }

  constructor(
    params: RegionParams,
    private totalDuration: number,
    private numberOfChannels = 0,
    private markerLayer?: HTMLElement,
  ) {
    super();

    this.subscriptions = [];
    this.id = params.id || `region-${Math.random().toString(32).slice(2)}`;
    this.start = this.clampPosition(params.start);
    this.end = params.end;
    this.resize = params.resize ?? true;
    this.color = params.color ?? "rgba(0, 0, 0, 0.1)";
    this.minLength = params.minLength ?? this.minLength;
    this.maxLength = params.maxLength ?? this.maxLength;
    this.channelIdx = params.channelIdx ?? -1;
    this.numberOfChannels = params.channelCount ?? this.numberOfChannels;
    this.contentEditable = params.contentEditable ?? this.contentEditable;
    this.highlighted = params.highlighted ?? false;
    this.faded = params.faded ?? false;
    this.review = params.review;
    this.element = this.initElement();
    this.placeInChannel();
    this.setContent(params.content);
    this.applyReview();
    if (this.highlighted || this.faded || this.review) this.paint();
    this.setPart();

    this.renderPosition();
    this.initMouseEvents();
  }

  private clampPosition(time: number): number {
    const maxEndTime = this.nextRegion ? this.nextRegion.start : this.totalDuration;
    return Math.max(0, Math.min(maxEndTime, time));
  }

  private setPart() {
    this.element.setAttribute("part", `${this.isMarker ? "marker" : "region"} ${this.id}`);
  }

  private addResizeHandles(element: HTMLElement) {
    const handleStyle = {
      position: "absolute",
      zIndex: "2",
      // The cap keeps the handles from overlapping on narrow regions.
      width: "min(6px, 50%)",
      height: "100%",
      top: "0",
      cursor: "ew-resize",
      wordBreak: "keep-all",
    };

    const leftHandle = createElement(
      "div",
      {
        part: "region-handle region-handle-left",
        style: {
          ...handleStyle,
          left: "0",
          borderLeft: "2px solid rgba(0, 0, 0, 0.5)",
          borderRadius: "2px 0 0 2px",
        },
      },
      element,
    );

    // Resize
    const resizeThreshold = 1;
    this.stopBodyDragFrom(leftHandle);
    this.subscriptions.push(
      makeDraggable(
        leftHandle,
        (dx) => this.onResize(dx, "start"),
        () => {
          this.resizeDrag = undefined;
          this.emit("resize-start", "start");
        },
        () => this.onEndResizing(),
        resizeThreshold,
      ),
    );

    // Always create a right handle. For open-ended regions it acts as a "ghost" handle: hidden by default,
    // revealed on hover. Dragging it materializes the explicit end (introduces a gap before the next
    // region).
    const rightHandle = createElement(
      "div",
      {
        part: "region-handle region-handle-right",
        style: {
          ...handleStyle,
          right: "0",
          borderRadius: "0 2px 2px 0",
          transition: "opacity 0.15s ease",
        },
      },
      element,
    );
    this.applyRightHandleAppearance(rightHandle);
    this.stopBodyDragFrom(rightHandle);

    const showGhost = () => {
      if (this.isOpenEnded) rightHandle.style.opacity = "0.6";
    };
    const hideGhost = () => {
      if (this.isOpenEnded) rightHandle.style.opacity = "0";
    };
    element.addEventListener("mouseenter", showGhost);
    element.addEventListener("mouseleave", hideGhost);
    this.subscriptions.push(() => {
      element.removeEventListener("mouseenter", showGhost);
      element.removeEventListener("mouseleave", hideGhost);
    });

    this.subscriptions.push(
      makeDraggable(
        rightHandle,
        (dx) => this.onResize(dx, "end"),
        () => this.onStartRightResize(),
        () => this.onEndResizing(),
        resizeThreshold,
      ),
    );
  }

  // A handle's pointerdown bubbles to the region body, which would start a
  // group drag on top of the resize. stopPropagation leaves the handle's own
  // drag listener running and only keeps the body's from firing.
  private stopBodyDragFrom(handle: HTMLElement) {
    const stop = (event: PointerEvent) => event.stopPropagation();
    handle.addEventListener("pointerdown", stop);
    this.subscriptions.push(() => handle.removeEventListener("pointerdown", stop));
  }

  private applyRightHandleAppearance(rightHandle: HTMLElement) {
    if (this.isOpenEnded) {
      rightHandle.style.borderRight = "2px dashed rgba(0, 0, 0, 0.5)";
      rightHandle.style.opacity = "0";
    } else {
      rightHandle.style.borderRight = "2px solid rgba(0, 0, 0, 0.5)";
      rightHandle.style.opacity = "1";
    }
  }

  private onStartRightResize() {
    this.resizeDrag = undefined;
    // If this is a ghost handle, materialize the implicit end so the standard end-resize math works
    // for the rest of the drag. Loose equality so we catch both `undefined` and `null`.
    // Regions are commonly constructed with `end: null`.
    if (this._explicitEnd == null) {
      this._explicitEnd = this.end;
      const rightHandle = this.element.querySelector(
        '[part*="region-handle-right"]',
      ) as HTMLElement | null;
      if (rightHandle) this.applyRightHandleAppearance(rightHandle);
    }
    this.emit("resize-start", "end");
  }

  private removeResizeHandles(element: HTMLElement) {
    const leftHandle = element.querySelector('[part*="region-handle-left"]');
    const rightHandle = element.querySelector('[part*="region-handle-right"]');
    if (leftHandle) {
      element.removeChild(leftHandle);
    }
    if (rightHandle) {
      element.removeChild(rightHandle);
    }
  }

  /**
   * Place the region in its channel. The first channel is at the top edge, below the
   * `--region-top-inset` the page may set, and the last at the bottom edge, less a margin. A region
   * is shifted up by the same share of its own height as its top is of the height left.
   */
  private placeInChannel() {
    const last = this.numberOfChannels - 1;
    const share = this.channelIdx >= 0 && last > 0 ? Math.min(this.channelIdx, last) / last : 0;
    const margin = CHANNEL_MARGIN_PX * (1 - 2 * share);
    const inset = "var(--region-top-inset, 0px)";
    this.element.style.top = `calc(${inset} + ${share} * (100% - ${inset}) + ${margin}px)`;
    this.element.style.transform = `translateY(${-share * 100}%)`;
  }

  private initElement() {
    const isMarker = this.isMarker;

    const element = createElement("div", {
      style: {
        position: "absolute",
        height: "auto",
        backgroundColor: isMarker ? "transparent" : this.color,
        borderLeft: isMarker ? "2px solid " + this.color : "none",
        borderRadius: "2px",
        boxSizing: "border-box",
        transition: "background-color 0.2s ease",
        cursor: "pointer",
        pointerEvents: "all",
      },
    });

    // Add resize handles
    if (!isMarker && this.resize) {
      this.addResizeHandles(element);
    }

    // The body drives moves. A selected region moves with the whole selection,
    // and any other region moves alone.
    this.subscriptions.push(
      makeDraggable(
        element,
        (dx) => this.emit("body-drag", dx),
        () => this.emit("body-drag-start"),
        () => this.emit("body-drag-end"),
      ),
    );

    return element;
  }

  private renderPosition() {
    const start = this.start / this.totalDuration;
    const end = (this.totalDuration - this.end) / this.totalDuration;
    this.element.style.left = `${start * 100}%`;
    this.element.style.right = `${end * 100}%`;
    if (this.reviewMarker) this.reviewMarker.style.left = `${start * 100}%`;
  }

  /**
   * Give a region to review its minimum width, its tooltip and its marker line,
   * which spans every row in a layer of its own.
   */
  private applyReview() {
    const { review, element } = this;
    // The region overflows its time span to reach the minimum width,
    // so it is drawn over its neighbours.
    element.style.minWidth = review ? `${REVIEW_MIN_WIDTH_PX}px` : "";
    element.style.zIndex = review ? "1" : "";
    if (review) {
      element.title = REVIEW_TITLES[review];
    } else {
      element.removeAttribute("title");
    }
    if (review && this.markerLayer) {
      this.reviewMarker ??= createElement(
        "div",
        {
          part: "review-marker",
          style: {
            position: "absolute",
            top: "0",
            bottom: "0",
            width: `${REVIEW_MARKER_WIDTH_PX}px`,
            pointerEvents: "none",
          },
        },
        this.markerLayer,
      );
      this.reviewMarker.style.backgroundColor = REVIEW_COLORS[review];
    } else {
      this.reviewMarker?.remove();
      this.reviewMarker = undefined;
    }
    this.renderPosition();
  }

  private initMouseEvents() {
    const { element } = this;
    if (!element) return;

    element.addEventListener("click", (e) => this.emit("click", e));
    element.addEventListener("mouseenter", (e) => this.emit("over", e));
    element.addEventListener("mouseleave", (e) => this.emit("leave", e));
    element.addEventListener("dblclick", (e) => this.emit("dblclick", e));

    if (this.contentEditable && this.content) {
      this.content.addEventListener("click", (e) => this.onContentClick(e));
      this.content.addEventListener("blur", () => this.onContentBlur());
    }
  }

  /**
   * Move one edge by the pointer's travel since the resize began, stopping at the nearest limit.
   * Measuring from the start of the resize, rather than step by step,
   * keeps the edge under the pointer once the pointer comes back from past a limit.
   */
  public _onUpdate(dx: number, side: "start" | "end") {
    if (!this.element.parentElement) return;
    const { width } = this.element.parentElement.getBoundingClientRect();
    if (this.resizeDrag?.side !== side) {
      this.resizeDrag = { side, origin: side === "start" ? this.start : this.end, dx: 0 };
    }
    this.resizeDrag.dx += dx;
    const target =
      this.resizeDrag.origin + pixelsToSeconds(this.resizeDrag.dx, width, this.totalDuration);
    const [lower, upper] = side === "start" ? this.startLimits() : this.endLimits();
    if (lower > upper) return;
    const time = Math.min(upper, Math.max(lower, target));
    if (time === (side === "start" ? this.start : this.end)) return;

    if (side === "start") {
      this.start = time;
    } else {
      this._explicitEnd = time;
    }
    this.renderPosition();
    this.emit("update", side);
  }

  /**
   * The range the start can be dragged in.
   * An open-ended previous region gives way down to its own start, and any other stops at its end.
   */
  private startLimits(): [number, number] {
    const prev = this.prevRegion;
    const floor = prev ? (prev.isOpenEnded ? prev.start : prev.end) : 0;
    return [Math.max(0, floor, this.end - this.maxLength), this.end - this.minLength];
  }

  private endLimits(): [number, number] {
    const ceiling = Math.min(this.totalDuration, this.nextRegion?.start ?? Infinity);
    return [this.start + this.minLength, Math.min(ceiling, this.start + this.maxLength)];
  }

  private onNeighborMoved(side: "prev" | "next") {
    if (side === "prev" || !this.isOpenEnded) return;

    const newEnd = this.nextRegion?.start;
    if (newEnd !== undefined) {
      this.renderPosition();
    }
  }

  private onResize(dx: number, side: "start" | "end") {
    if (!this.resize) return;
    this._onUpdate(dx, side);
  }

  private onEndResizing() {
    if (!this.resize) return;
    this.resizeDrag = undefined;

    // If the user dragged the end up against the next region's start (or the end of the audio),
    // drop the explicit end and revert to open-ended.
    if (this._explicitEnd != null) {
      const snapThreshold = 0.05;
      const ceiling = this._nextRegion?.start ?? this.totalDuration;
      if (this._explicitEnd >= ceiling - snapThreshold) {
        this._explicitEnd = undefined;
        this.renderPosition();
        const rightHandle = this.element.querySelector(
          '[part*="region-handle-right"]',
        ) as HTMLElement | null;
        if (rightHandle) this.applyRightHandleAppearance(rightHandle);
      }
    }

    this.emit("resize-end");
    this.emit("update-end");
  }

  private onContentClick(event: MouseEvent) {
    event.stopPropagation();
    const contentContainer = event.target as HTMLDivElement;
    contentContainer.focus();
    this.emit("click", event);
  }

  public onContentBlur() {
    this.emit("update-end");
  }

  public setSelected(selected: boolean) {
    this.selected = selected;
    if (!this.element) return;
    this.paint();
  }

  private get fill(): string {
    if (this.selected || this.highlighted) return SELECTION_COLOR;
    return this.review ? REVIEW_COLORS[this.review] : this.color;
  }

  private get labelOnFill(): string {
    return this.selected || this.highlighted ? LABEL_ON_SELECTION : LABEL_ON_REGION;
  }

  private paint() {
    this.element.style.opacity = this.faded ? FADED_OPACITY : "";
    this.element.style.backgroundColor =
      this.isMarker && this.fill === this.color ? "transparent" : this.fill;
    this.element.style.borderLeftColor = this.fill;
    this.element.style.cursor = this.selected ? "grab" : "pointer";
    if (this.contentOverlay) this.contentOverlay.style.backgroundColor = this.fill;
    if (this.contentOverlayLabel) this.contentOverlayLabel.style.color = this.labelOnFill;
  }

  /** Slide the region, and its explicit end if it has one, by `deltaSeconds`. */
  public _shiftBy(deltaSeconds: number) {
    this.start += deltaSeconds;
    if (this._explicitEnd != null) {
      this._explicitEnd += deltaSeconds;
    }
    this.renderPosition();
    this.emit("update");
  }

  public _setTotalDuration(totalDuration: number) {
    this.totalDuration = totalDuration;
    this.renderPosition();
  }

  /** Play the region from the start */
  public play() {
    this.emit("play");
  }

  /** Set the HTML content of the region */
  public setContent(content: string | undefined) {
    this.content?.remove();
    this.contentOverlay?.remove();
    this.contentOverlay = undefined;
    this.contentOverlayLabel = undefined;
    if (!content) {
      this.content = undefined;
      return;
    }
    const label = (color: string, textShadow = "none") => {
      const element = createElement("div", {
        style: { ...CONTENT_STYLE, color, textShadow },
        textContent: content,
      });
      clipLabel(element, this.labelMaxWidth);
      return element;
    };
    this.content = label(LABEL_ON_WAVEFORM, LABEL_HALO);
    if (this.contentEditable) {
      this.content.contentEditable = "true";
    }
    this.content.setAttribute("part", "region-content");
    this.element.appendChild(this.content);

    // Markers draw no fill of their own, so the whole label sits on the waveform.
    if (this.contentEditable || this.isMarker) return;

    // An opaque copy of the fill, clipped to the region box, buries the halo and the waveform-colored text.
    // Its own copy of the label then repaints just that part in a color suited to the fill.
    // The overhang is left untouched.
    this.contentOverlay = createElement("div", {
      style: {
        position: "absolute",
        inset: "0",
        overflow: "hidden",
        borderRadius: "inherit",
        backgroundColor: this.fill,
        pointerEvents: "none",
        zIndex: "1",
      },
    });
    this.contentOverlayLabel = label(this.labelOnFill);
    this.contentOverlay.appendChild(this.contentOverlayLabel);
    this.element.appendChild(this.contentOverlay);
  }

  /**
   * Cut the label off where the next label in its row starts, so that one shows whole.
   */
  public setLabelMaxWidth(width: string) {
    if (width === this.labelMaxWidth) return;
    this.labelMaxWidth = width;
    for (const label of [this.content, this.contentOverlayLabel]) {
      if (label) clipLabel(label, width);
    }
  }

  /** Update the region's options */
  public setOptions(options: Partial<Omit<RegionParams, "minLength" | "maxLength">>) {
    if (options.color) {
      this.color = options.color;
      this.paint();
    }

    if (options.start !== undefined || options.end !== undefined) {
      const isMarker = this.isMarker;
      this.start = this.clampPosition(options.start ?? this.start);
      this._explicitEnd = this.clampPosition(options.end ?? (isMarker ? this.start : this.end));
      this.renderPosition();
      this.setPart();
    }

    if (options.content) {
      this.setContent(options.content);
    }

    if (options.id) {
      this.id = options.id;
      this.setPart();
    }

    if (options.resize !== undefined && options.resize !== this.resize) {
      this.resize = options.resize;
      if (this.resize && !this.isMarker) {
        this.addResizeHandles(this.element);
      } else {
        this.removeResizeHandles(this.element);
      }
    }
  }

  /**
   * Move the region and update how it looks, keeping its element.
   * Positions are only clamped to the track. A neighbour may not have moved yet.
   */
  public patch({
    start,
    end,
    content,
    color,
    resize,
    channelIdx,
    channelCount,
    highlighted,
    faded,
    review,
  }: RegionParams) {
    const clamp = (time: number) => Math.max(0, Math.min(this.totalDuration, time));
    this.start = clamp(start);
    this._explicitEnd = end === undefined ? undefined : clamp(end);
    if (content !== this.content?.textContent) this.setContent(content);
    if (color && color !== this.color) this.setOptions({ color });
    if (resize !== undefined && resize !== this.resize) this.setOptions({ resize });
    if ((highlighted ?? false) !== this.highlighted || (faded ?? false) !== this.faded) {
      this.highlighted = highlighted ?? false;
      this.faded = faded ?? false;
      this.paint();
    }
    if (review !== this.review) this.setReview(review);
    if (channelIdx !== undefined || channelCount !== undefined) {
      this.channelIdx = channelIdx ?? this.channelIdx;
      this.numberOfChannels = channelCount ?? this.numberOfChannels;
      this.placeInChannel();
    }
    this.setPart();
    const rightHandle = this.element.querySelector(
      '[part*="region-handle-right"]',
    ) as HTMLElement | null;
    if (rightHandle) this.applyRightHandleAppearance(rightHandle);
  }

  public setReview(review: RegionReview | undefined) {
    this.review = review;
    this.applyReview();
    this.paint();
  }

  /**
   * Give the region an end at `end`, drawn at once. It may run past its next neighbour.
   */
  public growTo(end: number) {
    this._explicitEnd = Math.max(this.start, Math.min(this.totalDuration, end));
    this.renderPosition();
  }

  /**
   * Redraw the region where it is. An open-ended region reaches its next neighbour's start, so it
   * has to be redrawn when that neighbour moves.
   */
  public refreshPosition() {
    this.renderPosition();
    // Whether the region is a marker depends on that neighbour too, and a marker has no fill.
    this.paint();
  }

  /** Remove the region */
  public remove() {
    // Clean up subscriptions before removing element
    this.subscriptions.forEach((unsubscribe) => unsubscribe());
    this.subscriptions = [];

    // todo: fix firstRegion in plugin
    if (this.prevRegion) {
      this.prevRegion.nextRegion = this.nextRegion;
    }
    if (this.nextRegion) {
      this.nextRegion.prevRegion = this.prevRegion;
    }
    // Clear the region's references
    this.nextRegion = undefined;
    this.prevRegion = undefined;

    this.emit("remove");
    this.reviewMarker?.remove();
    this.reviewMarker = undefined;
    if (this.element) {
      this.element.remove();
      // This violates the type but we want to clean up the DOM reference
      this.element = null as unknown as HTMLElement;
    }
  }
}

class RegionsPlugin extends BasePlugin<RegionsPluginEvents, RegionsPluginOptions> {
  private regions: Region[] = [];
  private readonly regionsContainer: HTMLElement;
  private readonly markersContainer: HTMLElement;
  private readonly edgeLines: HTMLElement[];
  private resizing?: { region: Region; side: "start" | "end" };
  private firstRegion?: Region;
  // Kept as ids rather than references so a selection survives the
  // teardown-and-rebuild the host does whenever the timings change.
  private selectedIds = new Set<string>();
  private anchorId?: string;
  private selectable = true;
  private groupDrag?: Region[];
  private visibilityFrame = 0;
  private labelsFrame = 0;

  /** Create an instance of RegionsPlugin */
  constructor(options?: RegionsPluginOptions) {
    super(options);
    this.regionsContainer = this.initRegionsContainer();
    this.markersContainer = createElement("div", {
      part: "review-markers",
      style: {
        position: "absolute",
        inset: "0",
        zIndex: "4",
        pointerEvents: "none",
      },
    });
    this.edgeLines = [0, 1].map(() =>
      createElement(
        "div",
        {
          part: "region-edge-line",
          style: {
            position: "absolute",
            top: "0",
            height: "100%",
            borderLeft: `1px solid ${EDGE_LINE_COLOR}`,
            display: "none",
          },
        },
        this.markersContainer,
      ),
    );
  }

  /** Create an instance of RegionsPlugin */
  public static create(options?: RegionsPluginOptions) {
    return new RegionsPlugin(options);
  }

  /** Called by wavesurfer, don't call manually */
  onInit() {
    if (!this.wavesurfer) {
      throw Error("WaveSurfer is not initialized");
    }
    const wrapper = this.wavesurfer.getWrapper();
    wrapper.appendChild(this.regionsContainer);
    wrapper.appendChild(this.markersContainer);

    // Only a click on the bare waveform targets the wrapper itself.
    const clearOnBareClick = (event: MouseEvent) => {
      if (event.target === wrapper && this.selectedIds.size) this.clearSelection();
    };
    wrapper.addEventListener("click", clearOnBareClick);
    this.subscriptions.push(
      () => wrapper.removeEventListener("click", clearOnBareClick),
      listenForMarquee(this.wavesurfer, {
        canStart: () => this.selectable && this.regions.length > 0,
        // A selection is a run of consecutive regions, which only a box across every row shows.
        fullHeight: true,
        onChange: (area) => this.selectWithin(area),
      }),
    );

    // A zoom moves every region without necessarily scrolling, so redraw has to drive the pass too.
    this.subscriptions.push(
      this.wavesurfer.on("scroll", () => this.scheduleVisibilityPass()),
      this.wavesurfer.on("redraw", () => this.scheduleVisibilityPass()),
    );

    let activeRegions: Region[] = [];
    this.subscriptions.push(
      this.wavesurfer.on("timeupdate", (currentTime) => {
        // Detect when regions are being played
        const playedRegions = this.regions.filter(
          (region) =>
            region.start <= currentTime &&
            (region.end === region.start ? region.start + 0.05 : region.end) >= currentTime,
        );

        // Trigger region-in when activeRegions doesn't include a played regions
        playedRegions.forEach((region) => {
          if (!activeRegions.includes(region)) {
            this.emit("region-in", region);
          }
        });

        // Trigger region-out when activeRegions include an un-played regions
        activeRegions.forEach((region) => {
          if (!playedRegions.includes(region)) {
            this.emit("region-out", region);
          }
        });

        // Update activeRegions only played regions
        activeRegions = playedRegions;
      }),
    );
  }

  private initRegionsContainer(): HTMLElement {
    return createElement("div", {
      style: {
        position: "absolute",
        top: "0",
        left: "0",
        width: "100%",
        height: "100%",
        zIndex: "3",
        pointerEvents: "none",
        // The labels measure the room they have in cqw, a share of the whole track.
        containerType: "inline-size",
      },
    });
  }

  private scheduleLabelClip() {
    if (this.labelsFrame) return;
    this.labelsFrame = requestAnimationFrame(() => {
      this.labelsFrame = 0;
      this.clipLabels();
    });
  }

  /**
   * Cut each label off where the next one in its row starts.
   * A region's element is only attached while it is in view, so the order of the elements can't
   * decide which label covers which.
   */
  private clipLabels() {
    const duration = this.wavesurfer?.getDuration();
    if (!duration) return;
    for (const row of Object.values(groupBy(this.regions, (region) => region.channelIdx))) {
      const sorted = sortBy(row, (region) => region.start);
      sorted.forEach((region, i) => {
        const next = sorted[i + 1];
        const room = next ? `${((next.start - region.start) / duration) * 100}cqw` : "";
        region.setLabelMaxWidth(room);
      });
    }
  }

  private avoidOverlapping(newRegion: Region) {
    // Ensure regions don't overlap
    this.regions.forEach((reg) => {
      if (reg.id === newRegion.id) return;
      if (newRegion.isOpenEnded) {
        if (reg.isOpenEnded) return;
        if (reg.start < newRegion.start && newRegion.start < reg.end) {
          throw new OverlapError(newRegion, reg);
        }
      } else {
        if (reg.isOpenEnded) {
          if (newRegion.start < reg.start && newRegion.end > reg.start) {
            throw new OverlapError(newRegion, reg);
          }
        } else {
          if (reg.start < newRegion.end && newRegion.start < reg.end) {
            throw new OverlapError(newRegion, reg);
          }
        }
      }
    });
  }

  private setNextRegion(newRegion: Region) {
    // Place this region in the doubly-linked list of regions
    if (!this.firstRegion) {
      this.firstRegion = newRegion;
      return;
    }

    let region = this.firstRegion;
    while (region.start < newRegion.start && region.nextRegion) {
      region = region.nextRegion;
    }

    if (region.start > newRegion.start) {
      const prev = region.prevRegion;
      newRegion.prevRegion = prev;
      newRegion.nextRegion = region;
      region.prevRegion = newRegion;
      if (prev) {
        prev.nextRegion = newRegion;
      } else {
        this.firstRegion = newRegion;
      }
      this.checkRegions();
      return;
    }

    const nextRegion = region.nextRegion;
    region.nextRegion = newRegion;
    newRegion.prevRegion = region;

    if (nextRegion) {
      newRegion.nextRegion = nextRegion;
      nextRegion.prevRegion = newRegion;
    }
    this.checkRegions();
  }

  public checkRegions() {
    // Ensure linked list integrity and print region contents
    let region = this.firstRegion;
    while (region) {
      if (region.prevRegion && region.prevRegion.nextRegion !== region) {
        console.error(
          `Invalid linked list: ${region.prevRegion.nextRegion?.id} should be ${region.id}`,
        );
      }
      if (region.nextRegion && region.nextRegion.prevRegion !== region) {
        console.error(
          `Invalid linked list: ${region.nextRegion.prevRegion?.id} should be ${region.id}`,
        );
      }
      if (region.nextRegion && region.nextRegion.start < region.start) {
        console.error("Invalid linked list");
      }
      region = region.nextRegion;
    }
  }

  /** The live regions, for callers patching appearance in place instead of rebuilding. */
  public getRegions(): Region[] {
    return [...this.regions];
  }

  private orderedRegions(): Region[] {
    return [...this.regions].sort((a, b) => a.start - b.start);
  }

  /** The selected regions, in time order. */
  private getSelectedRegions(): Region[] {
    return this.orderedRegions().filter((region) => this.selectedIds.has(region.id));
  }

  public clearSelection() {
    this.setSelection([]);
    this.anchorId = undefined;
  }

  /**
   * Select one region, as a click on it does. A region that isn't drawn yet is selected once it is.
   */
  public selectRegion(id: string) {
    this.setSelection([id]);
    this.anchorId = id;
  }

  /**
   * Turn selecting regions by clicking, and moving them by dragging their body, on or off.
   */
  public setSelectable(selectable: boolean) {
    this.selectable = selectable;
    if (!selectable) this.clearSelection();
  }

  private setSelection(ids: string[]) {
    this.selectedIds = new Set(ids);
    this.regions.forEach((region) => region.setSelected(this.selectedIds.has(region.id)));
    this.emit("selection-change", ids);
  }

  private onRegionClicked(region: Region, event: MouseEvent) {
    if (!this.selectable) return;
    if ((event.target as Element).closest('[part~="region-handle"]')) return;
    if (this.selectedIds.has(region.id)) return this.clearSelection();

    const ordered = this.orderedRegions();
    const anchorIndex = ordered.findIndex((other) => other.id === this.anchorId);
    if (anchorIndex === -1) {
      this.anchorId = region.id;
      return this.setSelection([region.id]);
    }

    const clickedIndex = ordered.findIndex((other) => other.id === region.id);
    this.setSelection(
      ordered
        .slice(Math.min(anchorIndex, clickedIndex), Math.max(anchorIndex, clickedIndex) + 1)
        .map((other) => other.id),
    );
  }

  private onGroupDragStart(region: Region) {
    if (!this.selectable) return;
    this.groupDrag = this.selectedIds.has(region.id) ? this.getSelectedRegions() : [region];
    this.showEdgeLines();
  }

  private onGroupDrag(region: Region, dx: number) {
    const selection = this.groupDrag;
    if (!selection?.length) return;
    const first = selection[0];
    const last = selection[selection.length - 1];
    const { width } = this.regionsContainer.getBoundingClientRect();
    const duration = this.wavesurfer?.getDuration() ?? 0;
    const delta = clampGroupShift(
      { first, last, prev: first.prevRegion, next: last.nextRegion },
      pixelsToSeconds(dx, width, duration),
      duration,
    );
    if (!delta) return;
    this.scheduleLabelClip();
    selection.forEach((selectedRegion) => selectedRegion._shiftBy(delta));
    this.showEdgeLines();
    this.adjustScroll(region);
  }

  private onGroupDragEnd() {
    const selection = this.groupDrag;
    this.groupDrag = undefined;
    this.showEdgeLines();
    if (!selection?.length) return;
    this.emit("regions-updated", selection);
  }

  /**
   * Select the regions that overlap the stretch of time the box spans.
   */
  private selectWithin({ start, end, forward }: MarqueeArea) {
    const ids = this.orderedRegions()
      .filter((region) => region.start < end && region.end > start)
      .map((region) => region.id);
    // A click after the drag extends the selection from the side the drag started on.
    this.anchorId = forward ? ids[0] : ids[ids.length - 1];
    if (ids.length !== this.selectedIds.size || ids.some((id) => !this.selectedIds.has(id))) {
      this.setSelection(ids);
    }
  }

  private adjustScroll(region: Region) {
    const scrollContainer = this.wavesurfer?.getWrapper()?.parentElement;
    if (!scrollContainer) return;
    const { clientWidth, scrollWidth } = scrollContainer;
    if (scrollWidth <= clientWidth) return;
    const scrollBbox = scrollContainer.getBoundingClientRect();
    const bbox = region.element.getBoundingClientRect();
    const left = bbox.left - scrollBbox.left;
    const right = bbox.right - scrollBbox.left;
    if (left < 0) {
      scrollContainer.scrollLeft += left;
    } else if (right > clientWidth) {
      scrollContainer.scrollLeft += right - clientWidth;
    }
  }

  private scheduleVisibilityPass() {
    if (this.visibilityFrame) return;
    this.visibilityFrame = requestAnimationFrame(() => {
      this.visibilityFrame = 0;
      this.updateVisibility();
    });
  }

  // Measured once and mutated only where visibility flipped: reading layout back after a DOM write
  // forces a reflow, and a zoom relays out every region, so a read/write per region is quadratic.
  private updateVisibility() {
    if (!this.wavesurfer) return;
    const duration = this.wavesurfer.getDuration();
    const trackWidth = this.regionsContainer.clientWidth;
    if (!duration || !trackWidth) return;
    const viewLeft = this.wavesurfer.getScroll();
    const viewRight = viewLeft + this.wavesurfer.getWidth();

    const entering = document.createDocumentFragment();
    for (const region of this.regions) {
      if (!region.element) continue;
      const start = (region.start / duration) * trackWidth;
      const width = Math.max(
        ((region.end - region.start) / duration) * trackWidth,
        region.review ? REVIEW_MIN_WIDTH_PX : 1,
      );
      const isVisible = start + width > viewLeft && start < viewRight;
      if (isVisible === region.isAttached) continue;
      region.isAttached = isVisible;
      if (isVisible) entering.appendChild(region.element);
      else region.element.remove();
    }
    this.regionsContainer.appendChild(entering);
  }

  /**
   * Draw a line at the edge being dragged, or at both outer edges of the regions being moved.
   */
  private showEdgeLines() {
    const duration = this.wavesurfer?.getDuration() ?? 0;
    const group = this.groupDrag;
    let times: number[] = [];
    if (this.resizing) {
      times = [this.resizing.region[this.resizing.side]];
    } else if (group?.length) {
      times = [group[0].start, group[group.length - 1].end];
    }
    this.edgeLines.forEach((line, i) => {
      const shown = duration && i < times.length;
      Object.assign(line.style, {
        display: shown ? "" : "none",
        left: shown ? `${(times[i] / duration) * 100}%` : "",
      });
    });
  }

  private saveRegion(region: Region) {
    region.setSelected(this.selectedIds.has(region.id));
    this.scheduleVisibilityPass();
    this.avoidOverlapping(region);
    this.setNextRegion(region);
    this.regions.push(region);
    this.scheduleLabelClip();

    const regionSubscriptions = [
      region.on("update", (side) => {
        // Undefined side indicates that we are dragging not resizing. A group drag scrolls once for
        // the region under the cursor instead, or every member would fight over the scroll position.
        if (!side && !this.groupDrag) {
          this.adjustScroll(region);
        }
        this.scheduleLabelClip();
        if (side) this.showEdgeLines();
        this.emit("region-update", region, side);
      }),

      region.on("resize-start", (side) => {
        this.resizing = { region, side };
        this.showEdgeLines();
      }),

      region.on("resize-end", () => {
        this.resizing = undefined;
        this.showEdgeLines();
      }),

      region.on("update-end", () => {
        this.avoidOverlapping(region);
        this.scheduleLabelClip();
        this.emit("region-updated", region);
      }),

      region.on("play", () => {
        this.wavesurfer?.play();
        this.wavesurfer?.setTime(region.start);
      }),

      region.on("click", (e) => {
        this.onRegionClicked(region, e);
        this.emit("region-clicked", region, e);
      }),

      region.on("body-drag-start", () => this.onGroupDragStart(region)),

      region.on("body-drag", (dx) => this.onGroupDrag(region, dx)),

      region.on("body-drag-end", () => this.onGroupDragEnd()),

      region.on("dblclick", (e) => {
        this.emit("region-double-clicked", region, e);
      }),

      // Remove the region from the list when it's removed
      region.once("remove", () => {
        regionSubscriptions.forEach((unsubscribe) => unsubscribe());
        // A region removed mid-drag never ends its resize or move.
        if (this.resizing?.region === region) this.resizing = undefined;
        if (this.groupDrag?.includes(region)) this.groupDrag = undefined;
        this.showEdgeLines();
        this.regions = this.regions.filter((reg) => reg !== region);
        this.scheduleLabelClip();
        this.emit("region-removed", region);
      }),
    ];
    // Deliberately not in this.subscriptions: that array is never pruned, and the remove handler
    // above already owns these, so every rebuild would retain its whole generation of regions.

    this.emit("region-created", region);
  }

  /** Create a region with given parameters */
  public addRegion(options: RegionParams): Region {
    if (!this.wavesurfer) {
      throw Error("WaveSurfer is not initialized");
    }

    const duration = this.wavesurfer.getDuration();
    const numberOfChannels = 5; // this.wavesurfer?.getDecodedData()?.numberOfChannels
    const region = new SingleRegion(options, duration, numberOfChannels, this.markersContainer);

    if (!duration) {
      this.subscriptions.push(
        this.wavesurfer.once("ready", (duration) => {
          region._setTotalDuration(duration);
          this.saveRegion(region);
        }),
      );
    } else {
      this.saveRegion(region);
    }

    return region;
  }

  /**
   * Make the regions match the given ones without rebuilding them. A region whose id is still
   * wanted keeps its element, so nothing flickers. The given regions have to be in time order.
   */
  public syncRegions(params: RegionParams[]) {
    const wanted = new Set(params.map((param) => param.id));
    for (const region of [...this.regions]) {
      if (wanted.has(region.id)) continue;
      if (region === this.firstRegion) this.firstRegion = region.nextRegion;
      region.remove();
    }
    const live = new Map(this.regions.map((region) => [region.id, region]));
    const added: RegionParams[] = [];
    for (const param of params) {
      const region = param.id === undefined ? undefined : live.get(param.id);
      if (region) {
        region.patch(param);
      } else {
        added.push(param);
      }
    }
    this.regions.forEach((region) => region.refreshPosition());
    // Added last, so they are placed among regions that already have their new starts.
    for (const param of added) {
      try {
        this.addRegion(param);
      } catch (e) {
        console.error("Failed to add region", e);
      }
    }
    this.scheduleLabelClip();
    this.scheduleVisibilityPass();
  }

  /** Remove all regions */
  public clearRegions() {
    this.regions.forEach((region) => region.remove());
    this.regions = [];
    this.firstRegion = undefined;
  }

  /** Destroy the plugin and clean up */
  public destroy() {
    if (this.visibilityFrame) cancelAnimationFrame(this.visibilityFrame);
    if (this.labelsFrame) cancelAnimationFrame(this.labelsFrame);
    this.clearRegions();
    super.destroy();
    this.regionsContainer.remove();
    this.markersContainer.remove();
  }
}

export default RegionsPlugin;
export type Region = SingleRegion;
