# Fredy 80 quiz

Live quiz for Fredy's 80th birthday: players join from their phones, the host controls which question is open, everyone sees the same question, and the ranking counts correct answers.

- Player link: `https://lior-tech.github.io/fredy80-quiz/`
- Host screen: same link with `#host` (PIN in `config.js`)
- TV screen: same link with `#screen`

Files: `index.html` + `style.css` + `app.js` (views and game logic), `sync.js` (Firebase Realtime Database adapter, or a local test adapter when no Firebase config is set), `questions.js` (81 questions; `correct` = index of the right option, 0 to 3), `config.js` (game id, host PIN, Firebase config), `img/` (photos resized from the PowerPoint).

Firebase: create a project, add a Realtime Database (test mode is fine for the party), register a web app, paste its config into `config.js`, commit and push. Until then the page runs in local test mode (syncs only between tabs of one browser).
