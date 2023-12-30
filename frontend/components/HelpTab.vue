<template>
  <b-tab-item label="Introduction" icon="circle-info" class="scroll-wrapper">
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
        <strong>Step 4: Create The Video.</strong> After you've given an Enter
        press to the last lyric in the song, watch the preview and click the
        <code>Submit</code> button. Wait maybe 5 minutes. Eventually you'll be
        asked to download a zip file. Inside that zip is an
        <code>.mp4</code> file which is your karaoke video! The zip file also
        includes generated <code>subtitles.ass</code> and
        <code>timings.json</code> files that were used to make your video. You
        can ignore them unless you
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
          If you run into problems, create a GitHub issue
          <a href="https://github.com/incidentist/the_tuul/issues">here</a> or
          email me at andfurthermore[AT]gmail[DOT]com.
        </li>
      </ul>
      <h3>What's New</h3>
      <h5>December 29, 2023</h5>
      <ul>
        <li>
          <strong>Early Lyric Display</strong> - When the first line on a screen
          comes right after the last line on the previous screen, the line will
          appear early.
        </li>
      </ul>
      <h5>November 19, 2023</h5>
      <ul>
        <li>
          <strong>Fonts and Colors</strong> - You can configure the font and
          colors of your video before you submit it. Let me know if you want a
          specific font added.
        </li>
      </ul>
      <h5>October 21, 2023</h5>
      <ul>
        <li>
          <strong>New Backend</strong> - We now use a higher-quality vocal
          separation model from
          <a href="https://ultimatevocalremover.com/">Ultimate Vocal Remover</a
          >. It sounds better than Spleeter (our old model) and leaves in the
          background vocals. Thanks to
          <a href="https://github.com/beveradb">@beveradb</a> for the help!
        </li>
        <li>
          <strong>Works on Mobile</strong> - The Tüül has gone handheld. Mobile
          users should now be able to complete the entire process, thanks to
          "Spacebar" and "Enter" buttons. Show or hide the buttons by toggling
          the <b-icon icon="keyboard" /> button in the Song Timing tab.
        </li>
      </ul>
      <h5>June 25, 2023</h5>
      <ul>
        <li>
          <strong>Video Preview</strong> - You can now see what your video will
          look like before you create it. Unlike the finished video, the preview
          has vocals in it so you can see how well the timing matches up.
        </li>
      </ul>
      <h5>June 19, 2023</h5>
      <ul>
        <li>
          <strong>Instrumentals</strong> - The Tüül now adds a screen for long
          instrumental breaks. You can turn this on or off before you submit the
          video, in case you added your own screens for this. You can also turn
          count-ins on or off.
        </li>
      </ul>
      <h5>Feb 28, 2023</h5>
      <ul>
        <li>
          <strong>Count-ins</strong> - The Tüül now adds automatic count-ins
          after long instrumental breaks. It also adds a count-in for songs
          where the vocals start right away.
        </li>
      </ul>
    </div>
  </b-tab-item>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import AdvancedOptionsModal from "@/components/AdvancedOptionsModal.vue";

export default defineComponent({
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
});
</script>
