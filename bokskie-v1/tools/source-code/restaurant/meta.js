/* ============================================================
   bokskie-v1 / tools / source-code / restaurant / meta.js
   ------------------------------------------------------------
   The prose that ships with the restaurant page.
   ============================================================ */

module.exports = {
  concept: "restaurant website",
  title: "Restaurant website",
  file: "index.html",
  lang: "html",
  kind: "website",

  how: [
    "**The menu is a grid of six cards, and each price sits on the same line as its name** using `display: flex` with `justify-content: space-between`. That one rule is what makes a menu look like a menu rather than a list of paragraphs.",
    "**The reservation form knows the restaurant is closed on Mondays.** `getDay()` returns 1 for Monday, and the form refuses that date with a sentence explaining why. It is four lines, and it is the sort of detail a guest would otherwise find out about by turning up.",
    "**The phone check counts digits rather than matching a pattern,** so `0917 123 4567` and `09171234567` both pass. Validating what a person is likely to type beats validating the format you wished they had typed.",
    "**Prices are written as `&#8369;` rather than the peso sign directly,** so the file renders correctly no matter which encoding the server sends.",
    "**The mobile menu is CSS again** - a hidden checkbox and a sibling selector, so the header collapses on a phone with no JavaScript involved at all."
  ],

  change: [
    "**The dishes are plain HTML.** Each one is an `article.dish` with a name, a price and a paragraph. Copy one, change the text, and you have a seventh dish.",
    "**Change the colours in `:root`.** Six properties. The `spicy` and `Vegan` labels use the same accent colours as the rest of the page, so a re-skin moves them too.",
    "**The real gap is the back end.** The form confirms on screen and the reservation goes nowhere. To make it real, replace the last three lines of the submit handler with a call to your endpoint - the values are already in the `data` object.",
    "**Add a real gallery by dropping in `<img>` tags** where the menu grid is. Use `loading=\"lazy\"` on anything below the fold, which is the single most useful attribute on a page with photographs."
  ]
};
