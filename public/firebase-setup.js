import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-analytics.js";

const firebaseConfig = {
    apiKey: "AIzaSyDethBfqnt5gC1Zc2zwK4N1SHEfdwu7P_s",
    authDomain: "nerve-5ab2b.firebaseapp.com",
    projectId: "nerve-5ab2b",
    storageBucket: "nerve-5ab2b.firebasestorage.app",
    messagingSenderId: "456012223952",
    appId: "1:456012223952:web:691c5dbc318459126d15d5",
    measurementId: "G-PS5NJBZXXB"
};

const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
