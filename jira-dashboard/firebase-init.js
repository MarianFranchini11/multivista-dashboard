// firebase-init.js
// Initializes Firebase (Firestore) for the Resource Management page.
// Uses the "compat" SDK so it works with plain <script> tags, consistent
// with the rest of this project (no bundler).

const firebaseConfig = {
  apiKey: "AIzaSyD-raubqH2AketyGNtO0cj8OZonq1gwbZQ",
  authDomain: "multivista-dashboard.firebaseapp.com",
  projectId: "multivista-dashboard",
  storageBucket: "multivista-dashboard.firebasestorage.app",
  messagingSenderId: "1060906246862",
  appId: "1:1060906246862:web:7733c581f28d9a85c0e69f",
};

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
