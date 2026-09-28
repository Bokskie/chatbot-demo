/* ============================================================
   bokskie-v1 / tools / source-code / calculator / meta.js
   ------------------------------------------------------------
   The prose that ships with the calculator. Kept out of index.html
   for the same reason as every template: the file the user copies
   should be the calculator, not an essay about the calculator.
   ============================================================ */

module.exports = {
  concept: "calculator",
  title: "Calculator",
  file: "index.html",
  lang: "html",
  kind: "tool",

  how: [
    "**The whole calculator is four variables** - what is typed, what is remembered, the operator waiting to be applied, and a flag saying whether the next digit starts a new number. Every button is a branch in one function called `input`, which is why there is no special case anywhere else.",
    "**The keyboard works as well as the buttons.** One `keydown` listener maps `/`, `*`, `-`, `+`, `Enter`, `Backspace` and `Escape` onto the same `input` function the clicks use, so the two input methods cannot drift apart - there is only one implementation to be right.",
    "**Floating point is rounded at the display, not the calculation.** `Math.round(n * 1e10) / 1e10` is what stops `0.1 + 0.2` showing as `0.30000000000000004`. The arithmetic stays in full precision underneath; only the number you read is tidied.",
    "**Dividing by zero returns an error instead of `Infinity`,** and the long text shrinks through three font sizes rather than spilling out of the panel. Both are small decisions, and both are the difference between a calculator and a demo of one.",
    "**One listener, not twenty.** The click handler sits on the keypad and reads `data-k` off whichever button was pressed, so the keys are plain HTML and the JavaScript never has to be updated when the layout changes."
  ],

  change: [
    "**Change the colours in the `:root` block.** Seven properties, and nothing else in the file hard-codes a colour - including the operator and function key tints.",
    "**To add memory buttons (MC, MR, M+),** store a single `var memory = 0` and three more keys in `input` that read and write it. The structure is already there; it is three cases and three buttons.",
    "**To make it scientific,** add the functions you want as cases in `input` and use `Math.sqrt`, `Math.pow` and friends. The `apply` function is the only place an operation happens, so that is the only place you need to change.",
    "**It is a front-end only, on purpose.** Nothing is sent anywhere and it works with the network off. If you want calculations recorded, add `localStorage.setItem` in `input` - but note that a calculator that stores what it calculates should say so."
  ]
};
