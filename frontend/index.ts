import { createApp } from "vue";
import Buefy from 'buefy';
import { createPinia } from "pinia";
import { setupErrorHandling } from "@/lib/util";
import { collectLogContext } from "@/lib/logContext";
import App from "@/App.vue";
import "@/main.scss";

// Import our optimized FontAwesome configuration
import FontAwesomeIcon from './plugins/fontawesome';

// Set error handling
const logError = setupErrorHandling(collectLogContext);

window.addEventListener('load', function () {
    const pinia = createPinia();
    const app = createApp(App);
    app.use(pinia);
    app.use(Buefy, {
        defaultIconPack: 'fas',
        defaultIconComponent: 'font-awesome-icon',
    });
    app.config.errorHandler = logError;
    app.component('font-awesome-icon', FontAwesomeIcon);
    app.mount('#app');
});