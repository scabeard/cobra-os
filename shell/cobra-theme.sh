#!/usr/bin/env bash
#
# cobra-theme.sh — COBRA OS console theme: red-team cyberpunk, no X required.
#
# Installed at /etc/cobra/cobra-theme.sh and sourced from /etc/bash.bashrc
# (right after cobrashell) for every interactive bash shell. Everything here
# is pure terminal escape sequences + env vars — zero packages, zero daemons,
# zero network. Safe to source non-interactively: it only touches a real TTY.
#
# What it does:
#   1. Linux console (TERM=linux): remaps the 16-color VGA palette to the
#      COBRA neon palette via OSC 4-style escapes (\e]P0..\e]PF). Every
#      program that uses the standard 16 colors — including cobrashell's
#      PS1 and its CR/CG/CC variables — instantly goes cyberpunk.
#   2. LS_COLORS: neon file-type colors for ls/tree/nnn & co.
#   3. GREP_COLORS + LESS_TERMCAP_*: red-hot grep matches, neon man pages.
#
# Palette (the COBRA ramp):
#   bg      #050508  near-black, blue-tinted
#   fg      #d6dbe2  cold steel
#   red     #ff2a3c  primary neon red (errors, root, hot)
#   green   #3dff8f  phosphor green (success)
#   yellow  #ffb84d  amber (warnings)
#   blue    #4d7cff  electric blue
#   magenta #c95cff  neon violet
#   cyan    #2ee6e6  neon cyan (info)
#   brblack #3a3f4a  gunmetal (dim comments)
#
# Opt out per-shell:  export COBRA_THEME_OFF=1  (before the shell starts)

# Never run twice, never run without a TTY, honor the kill switch.
[ -n "${_COBRA_THEME_LOADED:-}" ] && return 0
_COBRA_THEME_LOADED=1
[ -n "${COBRA_THEME_OFF:-}" ] && return 0
[ -t 1 ] || return 0

# --- 1. Linux console palette remap ---------------------------------------
# Only the real framebuffer/VGA console understands \e]P<slot><rrggbb>.
# tmux/ssh/xterm keep their own (already themed) palettes.
if [ "${TERM:-}" = "linux" ]; then
    printf '\e]P0050508'   # 0  black     -> background
    printf '\e]P1ff2a3c'   # 1  red       -> neon red
    printf '\e]P23dff8f'   # 2  green     -> phosphor green
    printf '\e]P3ffb84d'   # 3  yellow    -> amber
    printf '\e]P44d7cff'   # 4  blue      -> electric blue
    printf '\e]P5c95cff'   # 5  magenta   -> neon violet
    printf '\e]P62ee6e6'   # 6  cyan      -> neon cyan
    printf '\e]P7d6dbe2'   # 7  white     -> cold steel (foreground)
    printf '\e]P83a3f4a'   # 8  brblack   -> gunmetal
    printf '\e]P9ff5566'   # 9  brred     -> hot pink-red
    printf '\e]PA7dffab'   # 10 brgreen   -> bright phosphor
    printf '\e]PBffd08a'   # 11 bryellow  -> warm amber
    printf '\e]PC7d9bff'   # 12 brblue    -> sky electric
    printf '\e]PDdd8cff'   # 13 brmagenta -> bright violet
    printf '\e]PE6ff2f2'   # 14 brcyan    -> ice cyan
    printf '\e]PFf4f6fa'   # 15 brwhite   -> near-white
    # Repaint so the new palette applies to the whole screen, not just new
    # output. \e[40m = bg from slot 0, \e[37m = fg from slot 7.
    printf '\e[40m\e[37m\e[2J\e[H'
fi

# --- 2. LS_COLORS -----------------------------------------------------------
# Built once at build time by chroot-setup.sh into /etc/cobra/ls_colors
# (dircolors -p | themed | dircolors -b -) so every file extension keeps a
# sane mapping. Fall back to a compact inline set if that file is missing.
if [ -r /etc/cobra/ls_colors ]; then
    # shellcheck disable=SC1091
    . /etc/cobra/ls_colors
else
    export LS_COLORS="rs=0:di=01;36:ln=01;35:so=01;31:pi=33:ex=01;31:bd=01;33:cd=01;33:su=37;41:sg=30;43:tw=30;42:ow=34;42:*.tar=01;31:*.gz=01;31:*.zip=01;31:*.jpg=01;35:*.png=01;35:*.pcap=01;32:*.txt=37:*.md=37"
fi

# --- 3. grep / less / man ----------------------------------------------------
# ms = match (bold black on neon red), mc = match in -v context, sl/cx reset.
export GREP_COLORS="ms=30;41:mc=30;41:sl=:cx=:fn=36:se=35:ln=32:bn=32"
# man/less: bold headers in neon red, underline in cyan, standout (status
# bar/search) black-on-red, end-caps reset.
export LESS_TERMCAP_mb=$'\e[1;31m'    # blink      -> bold red
export LESS_TERMCAP_md=$'\e[1;31m'    # bold       -> neon red
export LESS_TERMCAP_me=$'\e[0m'       # end bold
export LESS_TERMCAP_so=$'\e[30;41m'   # standout   -> black on red
export LESS_TERMCAP_se=$'\e[0m'       # end standout
export LESS_TERMCAP_us=$'\e[1;36m'    # underline  -> neon cyan
export LESS_TERMCAP_ue=$'\e[0m'       # end underline
