<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet version="1.0"
  xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
  <xsl:output method="html" encoding="UTF-8" doctype-system="about:legacy-compat"/>

  <xsl:template match="/">
    <html lang="en">
      <head>
        <meta charset="utf-8"/>
        <script>
<![CDATA[
(() => {
  try {
    const stored = localStorage.getItem("omapicks-theme");
    const theme = stored === "light" || stored === "dark"
      ? stored
      : (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    document.documentElement.dataset.theme = theme;
  } catch {
    document.documentElement.dataset.theme = "light";
  }
})();
]]>
        </script>
        <meta name="viewport" content="width=device-width, initial-scale=1"/>
        <title><xsl:value-of select="/rss/channel/title"/> · OmaPicks</title>
        <meta name="description" content="Champion changes in the weekly OmaPicks rankings."/>
        <meta name="color-scheme" content="light dark"/>
        <link rel="canonical" href="https://omapicks.com/feed.xml"/>
        <link rel="icon" href="/assets/icon.svg" type="image/svg+xml"/>
        <link rel="manifest" href="/site.webmanifest"/>
        <link rel="alternate" type="application/rss+xml" title="OmaPicks weekly changes" href="/feed.xml"/>
        <link rel="stylesheet" href="/assets/styles.css"/>
        <script src="/assets/app.js" defer="defer"><xsl:text> </xsl:text></script>
      </head>
      <body>
        <a class="skip-link" href="#main">Skip to content</a>
        <div class="page-wrap">
          <header class="site-header">
            <a class="brand" href="/" aria-label="OmaPicks home">OmaPicks</a>
            <nav aria-label="Primary navigation">
              <a href="/methodology/">Method</a>
              <a href="/changelog/">Changes</a>
              <a href="/feed.xml" aria-current="page">RSS</a>
              <button class="theme-toggle" type="button" data-theme-toggle="" aria-label="Switch to dark theme" aria-pressed="false">
                <span class="theme-label-dark" aria-hidden="true">Dark</span>
                <span class="theme-label-light" aria-hidden="true">Light</span>
              </button>
            </nav>
          </header>
          <main id="main">
            <section class="page-section">
              <p class="eyebrow">RSS feed</p>
              <h1>Weekly champion changes</h1>
              <p class="page-lede"><xsl:value-of select="/rss/channel/description"/> This browser view is provided for people; feed readers receive the same RSS 2.0 entries.</p>
              <p class="feed-subscribe"><strong>Subscribe:</strong> copy <a href="/feed.xml">https://omapicks.com/feed.xml</a> into your feed reader.</p>
              <section class="feed-entries" aria-label="Recent changes">
                <xsl:choose>
                  <xsl:when test="/rss/channel/item">
                    <xsl:for-each select="/rss/channel/item">
                      <article>
                        <time><xsl:value-of select="pubDate"/></time>
                        <div>
                          <h2>
                            <a>
                              <xsl:attribute name="href">
                                <xsl:value-of select="*[local-name()='link']"/>
                              </xsl:attribute>
                              <xsl:value-of select="title"/>
                            </a>
                          </h2>
                          <p><xsl:value-of select="description"/></p>
                        </div>
                      </article>
                    </xsl:for-each>
                  </xsl:when>
                  <xsl:otherwise>
                    <p class="feed-empty">No champion changes have been published yet.</p>
                  </xsl:otherwise>
                </xsl:choose>
              </section>
            </section>
          </main>
          <footer>
            <p>Plugin metadata, engagement signals, and previews come from <a href="https://plugins.omarchy.org/?sort=copies">Omarchy Plugins</a>. OmaPicks calculates the rankings independently and is not affiliated with Omarchy, 37signals, or omarchyplugins.com.</p>
            <p><a href="/methodology/#data-sources">Data and methodology</a> · <a href="/privacy/">Privacy</a> · <a href="https://github.com/BVisagie/omapicks">Open-source code</a></p>
          </footer>
        </div>
      </body>
    </html>
  </xsl:template>
</xsl:stylesheet>
