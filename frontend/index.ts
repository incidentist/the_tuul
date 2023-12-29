import Vue from "vue";
import Buefy from 'buefy';
import App from "@/App.vue";

import 'buefy/dist/buefy.css';
import '@fortawesome/fontawesome-free/css/all.css';

Vue.use(Buefy, {
    defaultIconPack: 'fas'
});

window.addEventListener('load', function () {
    const main = new Vue({
        el: '#app',
        components: {
            App
        },
        template: '<App/>'
    });
});

export default Vue