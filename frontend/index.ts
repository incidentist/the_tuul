import Vue from "vue";
import Buefy from 'buefy';
import { createPinia, PiniaVuePlugin } from "pinia";

import App from "@/App.vue";

import 'buefy/dist/buefy.css';
import '@fortawesome/fontawesome-free/css/all.css';

Vue.use(Buefy, {
    defaultIconPack: 'fas'
});
Vue.use(PiniaVuePlugin);

window.addEventListener('load', function () {
    const pinia = createPinia();
    const main = new Vue({
        pinia,
        el: '#app',
        components: {
            App
        },
        template: '<App/>'
    });
});

export default Vue