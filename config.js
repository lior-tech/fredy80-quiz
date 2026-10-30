// Game settings. Edit, commit, push.
window.QUIZ_CONFIG = {
  gameId: 'fredy80',      // one shared game room. Change the name to start a brand new room with a clean history.
  hostPin: '8080',        // code for the moderator screen (open the page with #host)
  title: 'חידון פרדי 80',

  // Firebase Realtime Database settings, copied from the Firebase console
  // (Project settings > General > Your apps > Web app > SDK setup and configuration).
  // While this stays null the game runs in local test mode: it syncs only between tabs of one browser.
  firebase: {
    apiKey: "AIzaSyCxmJcS7SP33JzsBM7xFVl28n8rui3KXJ0",
    authDomain: "fredy80-quiz.firebaseapp.com",
    databaseURL: "https://fredy80-quiz-default-rtdb.europe-west1.firebasedatabase.app",
    projectId: "fredy80-quiz",
    storageBucket: "fredy80-quiz.firebasestorage.app",
    messagingSenderId: "4880743146",
    appId: "1:4880743146:web:7072a104577b44765e3593"
  }
};
