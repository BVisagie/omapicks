<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet version="1.0"
  xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
  <xsl:output method="html" encoding="UTF-8" doctype-system="about:legacy-compat"/>

  <xsl:template match="/">
    <html lang="en">
      <head>
        <meta charset="utf-8"/>
        <meta name="viewport" content="width=device-width, initial-scale=1"/>
        <title><xsl:value-of select="/rss/channel/title"/></title>
        <meta name="description" content="Champion changes in the weekly OmaPicks rankings."/>
        <link rel="alternate" type="application/rss+xml" title="OmaPicks weekly changes" href="/feed.xml"/>
        <style>
          :root {
            color-scheme: light dark;
            --bg: #f3eee4;
            --surface: #faf6ee;
            --ink: #1a1612;
            --muted: #5c564c;
            --line: #c3b9a8;
            --accent: #b53415;
            --serif: "Iowan Old Style", "Palatino Linotype", Palatino, "Liberation Serif", Georgia, serif;
            --sans: system-ui, "Inter", "Segoe UI", sans-serif;
          }
          * { box-sizing: border-box; }
          body {
            margin: 0;
            background:
              radial-gradient(900px 360px at 8% -10%, rgb(181 52 21 / 9%), transparent 60%),
              var(--bg);
            color: var(--ink);
            font-family: var(--sans);
            line-height: 1.6;
          }
          a {
            color: inherit;
            text-decoration-color: color-mix(in srgb, var(--accent) 55%, transparent);
            text-underline-offset: 0.16em;
          }
          a:hover { color: var(--accent); }
          .page {
            width: min(760px, calc(100% - 2rem));
            margin: 0 auto;
          }
          header {
            display: flex;
            min-height: 5rem;
            align-items: center;
            justify-content: space-between;
            border-bottom: 1px solid var(--line);
          }
          .brand {
            font-family: var(--serif);
            font-size: 1.45rem;
            font-weight: 700;
            letter-spacing: -0.03em;
            text-decoration: none;
          }
          nav { display: flex; gap: 1.2rem; font-size: 0.88rem; }
          nav a { text-decoration: none; }
          main { padding: 4rem 0 5rem; }
          .eyebrow {
            margin: 0 0 0.7rem;
            color: var(--accent);
            font-size: 0.78rem;
            font-weight: 700;
            letter-spacing: 0.12em;
            text-transform: uppercase;
          }
          h1 {
            max-width: 12ch;
            margin: 0;
            font-family: var(--serif);
            font-size: clamp(2.8rem, 9vw, 4.7rem);
            line-height: 1.02;
            letter-spacing: -0.04em;
          }
          .intro {
            max-width: 42rem;
            margin: 1.25rem 0 2.5rem;
            color: var(--muted);
            font-size: 1.05rem;
          }
          .subscribe {
            margin: 0 0 2.8rem;
            padding: 1rem 1.1rem;
            border: 1px solid var(--line);
            background: var(--surface);
            color: var(--muted);
            font-size: 0.88rem;
          }
          .subscribe strong { color: var(--ink); }
          .entries { border-top: 1px solid var(--ink); }
          article {
            display: grid;
            grid-template-columns: 10rem minmax(0, 1fr);
            gap: 1.4rem;
            padding: 1.3rem 0;
            border-bottom: 1px solid var(--line);
          }
          time {
            color: var(--muted);
            font-size: 0.78rem;
          }
          h2 {
            margin: 0 0 0.35rem;
            font-family: var(--serif);
            font-size: 1.35rem;
            line-height: 1.2;
          }
          h2 a { text-decoration: none; }
          article p { margin: 0; color: var(--muted); }
          .empty {
            padding: 2rem 0;
            color: var(--muted);
          }
          footer {
            padding: 1.8rem 0 2.6rem;
            border-top: 1px solid var(--line);
            color: var(--muted);
            font-size: 0.8rem;
          }
          footer p { margin: 0; }
          @media (prefers-color-scheme: dark) {
            :root {
              --bg: #121316;
              --surface: #191b1f;
              --ink: #eceef1;
              --muted: #a5abb4;
              --line: #43484f;
              --accent: #ff7a52;
            }
          }
          @media (max-width: 560px) {
            header { align-items: flex-start; padding: 0.85rem 0; }
            nav { gap: 0.7rem; font-size: 0.78rem; }
            main { padding-top: 2.8rem; }
            article { grid-template-columns: 1fr; gap: 0.25rem; }
          }
        </style>
      </head>
      <body>
        <div class="page">
          <header>
            <a class="brand" href="/">OmaPicks</a>
            <nav aria-label="Primary navigation">
              <a href="/">Picks</a>
              <a href="/methodology/">Method</a>
              <a href="/changelog/">Changes</a>
            </nav>
          </header>
          <main>
            <p class="eyebrow">RSS feed</p>
            <h1>Weekly champion changes</h1>
            <p class="intro"><xsl:value-of select="/rss/channel/description"/> This browser view is provided for people; feed readers receive the same RSS 2.0 entries.</p>
            <p class="subscribe"><strong>Subscribe:</strong> copy <a href="/feed.xml">https://omapicks.com/feed.xml</a> into your feed reader.</p>
            <section class="entries" aria-label="Recent changes">
              <xsl:choose>
                <xsl:when test="/rss/channel/item">
                  <xsl:for-each select="/rss/channel/item">
                    <article>
                      <time><xsl:value-of select="pubDate"/></time>
                      <div>
                        <h2><a href="{link}"><xsl:value-of select="title"/></a></h2>
                        <p><xsl:value-of select="description"/></p>
                      </div>
                    </article>
                  </xsl:for-each>
                </xsl:when>
                <xsl:otherwise>
                  <p class="empty">No champion changes have been published yet.</p>
                </xsl:otherwise>
              </xsl:choose>
            </section>
          </main>
          <footer>
            <p>OmaPicks independently ranks public Omarchy plugin data. Quiet weeks stay quiet.</p>
          </footer>
        </div>
      </body>
    </html>
  </xsl:template>
</xsl:stylesheet>
