/* ============================================================
   bokskie-v1 / tools / source-code / todo / meta.js
   ------------------------------------------------------------
   The prose that ships with the to-do list.
   ============================================================ */

module.exports = {
  concept: "todo list",
  title: "To-do list",
  file: "index.html",
  lang: "html",
  kind: "tool",

  how: [
    "**The state is one array, and everything else is derived from it.** The visible list, the count and the three filters are all computed from `items` when `draw()` runs, so there is no second copy of anything to fall out of step.",
    "**Tasks are saved to `localStorage` under one key,** and loading is wrapped in a try/catch that treats unreadable data as an empty list. A corrupted entry should cost you the list, not the page - which is what an unguarded `JSON.parse` on load would do.",
    "**Task text is escaped before it goes into the page.** Tasks are typed by a person and then written into the list with `innerHTML`, so a task called `<img src=x onerror=...>` would otherwise run itself. The `escape` function is the whole defence, and it is why `innerHTML` is safe here at all.",
    "**Editing happens in place** - clicking the text turns it into a field, Enter keeps it, Escape puts it back. An inline field is more code than `prompt()` and far less annoying to use.",
    "**The checkbox is a real `<input>`, hidden and restyled,** rather than a styled `<div>`. That is the difference between a list you can tab through and use with a screen reader, and one that only works with a mouse."
  ],

  change: [
    "**To add due dates or priorities,** add the field to each task in `add()` and render it in `draw()`. Nothing else needs to change - the state has no fixed shape, it is just objects.",
    "**To sync between devices,** replace the two functions `load` and `save` with calls to your server. They are the only place that touches storage, which is why they are separate functions rather than scattered calls.",
    "**To change what is kept,** the key is the `KEY` constant near the top. Change it and you start with a clean list, which is also how you ship a version without migrating anybody's data.",
    "**It is local only, and the page says so.** Nothing leaves the browser. If you add a server, that sentence in the header is no longer true and should change with it."
  ]
};
