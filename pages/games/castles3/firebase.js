const firebaseConfig = {
  apiKey: "AIzaSyBP4-umlnVxOkvHiUCj6MDVa4Z3452BML0",
  authDomain: "castles-64558.firebaseapp.com",
  projectId: "castles-64558",
  storageBucket: "castles-64558.appspot.com",
  messagingSenderId: "450284390955",
  appId: "1:450284390955:web:7e9e30ed7834635755f86e",
  measurementId: "G-EFJJGH1GDK"
};

if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
window.castlesDb = firebase.database();
