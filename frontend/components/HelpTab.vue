<template>
  <b-tab-item label="Introduction" icon="info-circle" class="scroll-wrapper">
    <div class="content">
      <p>
        <strong>Step 1: Choose a music file.</strong> Click the
        <code>Choose a song file</code> button and pick your song. Easy.
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
        <strong>Step 4: Create The Video.</strong> After you've given a spacebar
        press to the last lyric in the song, click the
        <code>Submit</code> button. Wait a few minutes -- maybe 3? Maybe 6?
        Eventually you'll be asked to download a zip file. Inside that zip is an
        <code>.mp4</code> file which is your karaoke video! The zip file also
        includes generated <code>subtitles.ass</code> and
        <code>timings.json</code> files that were used to make your video. You
        can ignore them. You can ignore them unless you
        <a @click="onDevLinkClick">know what you're doing</a>.
      </p>
      <h3>Some Notes</h3>
      <ul>
        <li>
          A video demonstration of how to use this thing is
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
          If you run into problems of any kind, create a GitHub issue
          <a href="https://github.com/incidentist/the_tuul/issues">here</a> or
          email me at andfurthermore[AT]gmail[DOT]com.
        </li>
      </ul>
      <h3>What's New</h3>
      <h5>Feb 28, 2023</h5>
      <ul>
        <li>
          <strong>Count-ins</strong> - The Tüül now adds automatic count-ins
          after long instrumental breaks. It also adds a count-in for songs
          where the vocals start right away.
        </li>
      </ul>
      <h5>Dec 28, 2022</h5>
      <ul>
        <li>
          <strong>New lyric tools</strong> - Marking up lyrics is faster now,
          with a button that converts spaces to underscores and a "magic
          slashes" mode: when you add a slash to a word to divide syllables, it
          applies that slash to every instance of the word. This speeds up the
          process of marking every syllable in a song.
        </li>
      </ul>
      <h5>Dec 10, 2022</h5>
      <ul>
        <li>
          <strong>beta.the-tuul.com</strong> - A version of The Tüül with beta
          features is available at
          <a href="https://beta.the-tuul.com">beta.the-tuul.com</a>. Try making
          your song on the beta. If something doesn't work, you can go back to
          regular ol' <a href="https://the-tuul.com">the-tuul.com</a>.
        </li>
        <li>
          <strong>Title screens</strong> - Your videos will now have a (very
          basic) title screen!
        </li>
      </ul>
    </div>
  </b-tab-item>
</template>

<script>
import AdvancedOptionsModal from "@/components/AdvancedOptionsModal.vue";

export default {
  methods: {
    onDevLinkClick() {
      this.$buefy.modal.open({
        parent: this,
        component: AdvancedOptionsModal,
        width: "80%",
        events: {
          "options-change": (e) => {
            this.$emit("options-change", e);
          },
        },
      });
    },
  },
};
</script>
