/* ============================================================
   bokskie-v1 / tools / source-code / portfolio / meta.js
   ------------------------------------------------------------
   The prose that ships with the portfolio page.
   ============================================================ */

module.exports = {
  concept: "portfolio website",
  title: "Portfolio website",
  file: "index.html",
  lang: "html",
  kind: "website",

  how: [
    "**The only JavaScript is the year in the footer.** A portfolio is a document, not an application, and every interactive thing on a page like this is one more thing that can break on somebody's phone.",
    "**The two-column work history collapses to one on a phone** with a single `@media` rule, because this is genuinely two columns of content and not a card grid pretending. The project cards below it use `auto-fit` instead, which is the right tool for each.",
    "**`prefers-reduced-motion` is respected.** The page has `scroll-behavior: smooth` so the anchor links glide, and that is switched off entirely for anyone who has asked their operating system for less motion. It is three lines and it is the difference between a page that is considerate and one that is merely smooth.",
    "**Two typefaces and two sizes do the work.** A mono stack for names, headings and the meta line, a sans for prose. Hierarchy without a single font-size above 3.6rem, which is what makes a dark page easy to read.",
    "**The links go to real places** - mailto for the email, and replace the `#` hrefs on the three project and profile links with your own."
  ],

  change: [
    "**Everything you need to edit is in the HTML.** The name is in two places, the job history is three `div.job` blocks, and the projects are three `div.card` blocks. Copy one and there is a fourth.",
    "**Change the colours in `:root`.** Seven properties, and nothing else in the file hard-codes a value - the dark background, the panel, the borders, the dimmed text and the one accent all come from there.",
    "**Swap the placeholder projects for your own** and point the `href` at the real repository. A project card with a dead link is worse than no project card.",
    "**If you want a light mode,** the structure is already a set of variables, so it is a second `:root` block with different values rather than a second stylesheet."
  ]
};
