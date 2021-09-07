const LyricDisplay = {
    props: {
        lyricSegments: Array,
        currentSegment: Number
    },
    computed: {
        completedLyrics() {
            return this.lyricSegments.slice(0, this.currentSegment).map(this.wrapLyricSegment).join('');
        },
        currentLyrics() {
            if (this.lyricSegments.length == 0) {
                return '';
            }
            return this.wrapLyricSegment(this.lyricSegments[this.currentSegment]);
        },
        upcomingLyrics() {
            return this.lyricSegments.slice(this.currentSegment + 1).map(this.wrapLyricSegment).join('');
        },
    },
    methods: {
        wrapLyricSegment(segment) {
            return segment.text;
        }
    },
    template: `<div class="lyric-display">
    <span class="completed-lyrics">{{completedLyrics}}</span>
    <span class="current-lyrics">{{currentLyrics}}</span>
    <span class="upcoming-lyrics">{{upcomingLyrics}}</span>
    </div>`
}

const App = {
    components: {
        LyricDisplay
    },
    data() {
        return {
            lyricSegments: [],
            currentSegment: 0
        }
    },
    mounted() {
        window.addEventListener('keydown', this.onKeyDown);
        this.loadLyrics();
    },
    methods: {
        async loadLyrics() {
            const response = await fetch('/lyrics.txt');
            console.log(response);
            this.lyricSegments = this.parseLyricSegments(await response.text());
        },
        parseLyricSegments(lyricsText) {
            const segments = [];
            for (const line of lyricsText.split("\n")) {
                if (line == '') {
                    continue;
                }
                for (const segment of (line + "\n").split("/")) {
                    segments.push({
                        text: segment
                    });
                }
            }
            return segments;
        },
        onKeyDown(e) {
            this.currentSegment += 1;
            return false;
        }
    },
    template: `<lyric-display :lyric-segments="lyricSegments" :current-segment="currentSegment" @keydown="onKeyDown"></lyric-display>`
};

window.addEventListener('load', function () {
    Vue.createApp(App).mount("#app");
});