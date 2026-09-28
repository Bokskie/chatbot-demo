/* ============================================================
   bokskie-v1 / tools / source-code / resort / meta.js
   ------------------------------------------------------------
   The prose that ships WITH the code. Kept out of index.html
   deliberately: the .html file is the thing the user copies, and
   a page that begins with an essay about itself is a worse
   starting point than a page that just works.

   build-code.js reads this plus index.html and writes
   data/code.json.

   The `how` and `change` lists are markdown on purpose - the app
   already renders markdown, so the explanation arrives as a
   formatted list rather than a wall of asterisks.
   ============================================================ */

module.exports = {
  concept: "resort website",
  title: "Resort website",
  file: "index.html",
  lang: "html",
  kind: "website",

  how: [
    "**Save this as `index.html` and open it in a browser.** No server, no install, no dependencies - the CSS and the JavaScript are already inside the file.",
    "**The layout is one column on a phone and several on a wide screen,** done with CSS Grid and `repeat(auto-fit, minmax(260px, 1fr))`. The `auto-fit` is the important word: cards wrap into as many columns as fit, so you get three across on a desktop and one on a phone without writing a single media query.",
    "**The mobile menu is CSS, not JavaScript.** The checkbox `#nav-toggle` is visually hidden but still reachable by keyboard, and the rule that hides `.nav-links` is overridden the moment `#nav-toggle:checked ~ .nav-links` matches. That is why opening the menu needs no script at all.",
    "**The booking form is the JavaScript,** and it does three things: it checks the fields, it stops the page reloading, and it shows a confirmation using the dates it was given. The dates are formatted for the reader rather than echoed raw out of the input box.",
    "**The year in the footer is `new Date().getFullYear()`,** so it stays correct forever. That is the most common line of JavaScript on a real page and it is worth seeing early."
  ],

  change: [
    "**Change the colours in the `:root` block at the top of the CSS.** Six custom properties drive the whole design - `--sand`, `--deep`, `--sea`, `--gold`, `--ink`, `--paper`. Change those and the entire site re-skins, because nothing else in the file hard-codes a colour.",
    "**Replace the placeholder images.** The `div.photo` blocks with a `linear-gradient` background are stand-ins, so the file has no external requests that can break. Swap them for real photos with `<img src=\"your-photo.jpg\" alt=\"A description of it\">` and keep the images in the same folder.",
    "**The room names, prices and descriptions are plain text in the HTML.** Find the `<h3>` elements inside `#rooms` and edit them. Nothing is stored anywhere, so there is no database to update - which is also the limitation worth knowing before this takes real bookings.",
    "**To connect a real booking service,** the form's `submit` handler is the one place to change: send the collected values to your endpoint instead of showing the confirmation. The `FormData` line already gathers them."
  ]
};
