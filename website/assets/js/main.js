/* COBRA OS — cobra-os.com
   Typed hero terminal + mobile nav. Vanilla JS, no dependencies, no network. */
(function () {
  "use strict";

  /* ---------- mobile nav ---------- */
  var burger = document.getElementById("navBurger");
  var links = document.getElementById("navLinks");
  if (burger && links) {
    burger.addEventListener("click", function () {
      var open = links.classList.toggle("open");
      burger.setAttribute("aria-expanded", open ? "true" : "false");
    });
    links.addEventListener("click", function (e) {
      if (e.target.tagName === "A") {
        links.classList.remove("open");
        burger.setAttribute("aria-expanded", "false");
      }
    });
  }

  /* ---------- typed hero terminal ---------- */
  var term = document.getElementById("heroTerm");
  if (!term) return;

  var reduced = window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var BANNER = [
    "   ____   ___   ____   ____       _       ___   ____  ",
    "  / ___| / _ \\ | __ ) |  _ \\     / \\     / _ \\ / ___| ",
    " | |    | | | ||  _ \\ | |_) |   / _ \\   | | | |\\___ \\ ",
    " | |___ | |_| || |_) ||  _ <   / ___ \\  | |_| |___) |",
    "  \\____| \\___/ |____/ |_| \\_\\ /_/   \\_\\  \\___/|____/ "
  ];

  var PROMPT = '<span class="t-green">operator@cobra</span>:<span class="t-blue">~</span>$ ';

  /* script: html = printed instantly, type = typed char by char, pause = ms after */
  var SCRIPT = [
    { html: '<span class="t-red">' + BANNER.join("\n") + "</span>\n" +
            '<span class="t-cyan">  minimal · hardened · console-only — red team live OS</span>\n\n', pause: 500 },
    { prompt: true, type: "opshelp", pause: 350 },
    { html: '<span class="t-fg">COBRA operator commands (cobra-ops)</span>\n' +
            '  <span class="t-red">recon</span>    fscan portscan svcscan vulnscan udpscan dnsq whois smbenum\n' +
            '  <span class="t-red">web</span>      webdir webvuln sql\n' +
            '  <span class="t-red">creds</span>    brute crack hashcrack\n' +
            '  <span class="t-red">intel</span>    sploit privesc\n' +
            '  <span class="t-red">capture</span>  sniff pcap listen serve\n' +
            '  <span class="t-red">payload</span>  egg upserv\n' +
            '  <span class="t-red">dash</span>     mon files web\n\n', pause: 900 },
    { prompt: true, type: "target 10.10.14.6", pause: 250 },
    { html: '<span class="t-green">TARGET → 10.10.14.6</span>\n\n', pause: 500 },
    { prompt: true, type: "fscan", pause: 300 },
    { html: '<span class="t-cyan">$ nmap -T4 -F 10.10.14.6</span>\n' +
            'Starting Nmap 7.98 ( https://nmap.org )\n' +
            'Nmap scan report for <span class="t-amber">10.10.14.6</span>\n' +
            'PORT     STATE SERVICE\n' +
            '<span class="t-green">22/tcp   open  ssh</span>\n' +
            '<span class="t-green">80/tcp   open  http</span>\n' +
            '<span class="t-green">443/tcp  open  https</span>\n' +
            '<span class="t-dim">Nmap done: 1 IP address (1 host up) scanned in 1.37 seconds</span>\n\n', pause: 900 },
    { prompt: true, type: "listen 4444", pause: 300 },
    { html: '<span class="t-cyan">$ nc -lvnp 4444</span>\n' +
            '<span class="t-dim">listening on [any] 4444 ...</span>\n' +
            '<span class="t-green">connect to [10.10.14.2] from 10.10.14.6:51822</span>\n' +
            '<span class="t-violet"># shell landed — run it in its own tmux pane</span>\n\n', pause: 1100 },
    { prompt: true, type: "xtmux", pause: 300 },
    { html: '<span class="t-dim">[xtmux] tmux on hidden socket /dev/shm/.x — invisible to `tmux ls`</span>\n\n', pause: 1400 },
    { html: '<span class="t-dim">— session replay complete · history: /dev/null —</span>\n\n', pause: 6000 },
    { clear: true }
  ];

  var cursor = '<span class="term-cursor"></span>';
  var out = "";        // committed html
  var step = 0;

  function render(typing) {
    term.innerHTML = out + (typing || "") + cursor;
  }

  function nextStep() {
    if (step >= SCRIPT.length) { step = 0; }
    var s = SCRIPT[step++];

    if (s.clear) { out = ""; nextStep(); return; }

    if (s.html) {
      out += s.html;
      render();
      setTimeout(nextStep, reduced ? 0 : s.pause);
      return;
    }

    if (s.type) {
      var cmd = s.type, i = 0;
      var base = out + (s.prompt ? PROMPT : "");
      (function typeChar() {
        i++;
        render((s.prompt ? PROMPT : "") + cmd.slice(0, i));
        if (i < cmd.length) {
          setTimeout(typeChar, reduced ? 0 : 34 + Math.random() * 60);
        } else {
          out = base + cmd + "\n";
          render();
          setTimeout(nextStep, reduced ? 0 : s.pause);
        }
      })();
      return;
    }

    nextStep();
  }

  /* start when the terminal scrolls into view (or immediately if already visible) */
  function startWhenVisible() {
    if (!("IntersectionObserver" in window)) { nextStep(); return; }
    var io = new IntersectionObserver(function (entries) {
      if (entries[0].isIntersecting) { io.disconnect(); nextStep(); }
    }, { threshold: 0.15 });
    io.observe(term);
  }

  render();
  startWhenVisible();
})();
