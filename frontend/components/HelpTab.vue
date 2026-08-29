<template>
  <b-tab-item label="Introduction" icon="circle-info" class="scroll-wrapper">
    <div class="content">
      <p>
        <strong>Step 1: Choose a music file.</strong> Click the
        <code>Song File</code> tab and pick your song via a YouTube URL or local
        file. Easy. Click `Start Separation` to start the process of creating
        the instrumental track while you work on the rest of it.
      </p>
      <p>
        <strong>Step 2: Prepare the lyrics.</strong> Paste song lyrics into the
        <code>Lyrics</code> box. Next, divide them up into screens by adding a
        blank line between the last line of one screen and the first line of the
        next. <strong>Pro tip:</strong> listen to the song once while reading
        the lyrics, to make sure all the lyrics are there. Sometimes the
        Internet is wrong.
      </p>
      <p>
        <strong>Step 3: Add Timing Information.</strong> You're gonna tell The
        Tüül when all those lyrics appear in the song. When you hit the Play
        button, the song will start playing, and the first lyric-bit that you
        chopped up will be highlighted in pink.
        <strong>Hit the spacebar</strong> when that lyric comes up, and then the
        next lyric will turn pink and await your spacebar-press.
      </p>
      <p>
        If you hit the <strong>Enter</strong> key while the song is playing,
        that will mark the end of the <strong>previous</strong> lyric. Do that
        when there's a gap between lines or words. It can be tricky to handle
        both the spacebar and the enter key. If the song is going too fast, slow
        it down by clicking a different playback speed.
      </p>
      <p>If you need to take a break, hit the Pause button.</p>
      <p>
        <strong>Step 5: Adjust timings (Optional, and in beta).</strong> Head to
        the Adjust tab to preview your track. If any of the timings seem off,
        drag the edges of that lyric until the timing is better.
      </p>
      <p>
        <strong>Step 6: Create The Video.</strong> After you've given an Enter
        press to the last lyric in the song, you can watch the preview, fiddle
        with fonts and colors, and click the <code>Submit</code> button. Wait
        5-10 minutes. Eventually you'll be asked to download a zip file. Inside
        that zip is an <code>.mp4</code> file which is your karaoke video! The
        zip file also includes generated <code>subtitles.ass</code> and
        <code>timings.json</code> files that were used to make your video. You
        can upload them to the Song Info tab if you want to re-do your video
        without re-doing the timings.
      </p>
      <h3>Some Notes</h3>
      <ul>
        <li>
          A (somewhat outdated) video demonstration of how to use this thing is
          <a href="https://www.youtube.com/watch?v=f6yzza_ZZY8">here</a>.
        </li>
        <li>
          A beta version of The Tüül is available at
          <a href="https://beta.the-tuul.com">beta.the-tuul.com</a>. Try making
          your song on the beta and play around with its new features. If
          something doesn't work, you can go back to regular ol'
          <a href="https://the-tuul.com">the-tuul.com</a>.
        </li>
        <li>
          If you run into problems, create a GitHub issue
          <a href="https://github.com/incidentist/the_tuul/issues">here</a> or
          email me at andfurthermore[AT]gmail[DOT]com.
        </li>
      </ul>
      <h3>What's New</h3>
      <h5>0.18 - August 24, 2026</h5>
      <ul>
        <li>Bug fixes and under-the-hood improvements.</li>
      </ul>
      <h5>0.17 - September 19, 2025</h5>
      <ul>
        <li>Faster video creation using GPUs or Modal.com</li>
        <li>Bug fixes and under-the-hood improvements.</li>
      </ul>
      <h5>0.15 - June 14, 2025</h5>
      <ul>
        <li>Lots of under-the-hood changes and bugfixes.</li>
      </ul>
      <h5>0.13 - April 24, 2025</h5>
      <ul>
        <li>Initial beta of new timing-adjustment interface!</li>
        <li>
          YouTube downloads should be fixed now, for real, hopefully? For the
          self-hosters out there, you can give it a SOCKS5 proxy for downloading
          YouTubes.
        </li>
        <li>Many under-the-hood fixes, including migrations to vitest, vite and Vue 3.</li>
      </ul>
      <h5>0.11 - February 19, 2025</h5>
      <ul>
        <li>YouTube downloads should be fixed now.</li>
      </ul>
      <h5>0.10 - August 11, 2024</h5>
      <ul>
        <li>
          <strong>Background Separation</strong> - Start creating the
          instrumental track while you work on the lyric timings. Multitasking!
        </li>
        <li>
          <strong>Slower Playback</strong> - Options for even slower playback
          during lyric timings.
        </li>
        <li>
          <strong>Bring Your Own Files</strong> - Use your own backing track, or
          song timings, by uploading them to the Advanced section of the Song
          Info tab.
        </li>
      </ul>
      <h5>0.9 - July 4, 2024</h5>
      <ul>
        <li>
          <strong>YouTube videos</strong> - You can now import a YouTube video
          instead of uploading a file. The video will be included in the final
          karaoke video, or you can disable `Use Background Video` on the
          preview page to just use the audio. Including the video will make the
          creation process take longer.
        </li>
        <li>
          <strong>Local Video Creation</strong> - After the instrumental track
          is created, the actual video creation process is done on your computer
          instead of in the cloud. This is going to allow for some cool stuff in
          the future.
        </li>
      </ul>
    </div>
  </b-tab-item>
</template>

<script lang="ts">
import { defineComponent } from "vue";

export default defineComponent({});
</script>
