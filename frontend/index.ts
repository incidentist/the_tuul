import Vue from "vue";
import Buefy from 'buefy';
import { createPinia, PiniaVuePlugin } from "pinia";
import { setupErrorHandling } from "@/lib/util";

import App from "@/App.vue";

import 'buefy/dist/buefy.css';
import '@fortawesome/fontawesome-free/css/all.css';

Vue.use(Buefy, {
    defaultIconPack: 'fas'
});
Vue.use(PiniaVuePlugin);

// Set error handling
const logError = setupErrorHandling();
Vue.config.errorHandler = logError;

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