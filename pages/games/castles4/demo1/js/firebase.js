// js/firebase.js
// Plain JS initializer for Firebase compat SDK.
// Assumes the Firebase compat scripts are loaded in the HTML *before* this file.

(function () {
  // Your existing config:
  const firebaseConfig = {
    apiKey: "AIzaSyBP4-umlnVxOkvHiUCj6MDVa4Z3452BML0",
    authDomain: "castles-64558.firebaseapp.com",
    projectId: "castles-64558",
    storageBucket: "castles-64558.appspot.com",
    messagingSenderId: "450284390955",
    appId: "1:450284390955:web:7e9e30ed7834635755f86e",
    measurementId: "G-EFJJGH1GDK"
  };

  if (typeof firebase === "undefined") {
    console.error("Firebase SDK not found. Make sure the compat scripts are included before js/firebase.js");
    return;
  }

  if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
  }

  // Expose database handle globally (what teacher.js/student.js expect)
  window.db = firebase.database();
})();
