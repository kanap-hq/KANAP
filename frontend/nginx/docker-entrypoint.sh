#!/bin/sh
# Start-up of the web image (its ENTRYPOINT, in place of the one of the nginx base image). It reads
# two variables, checks them, writes under /tmp/nginx the files that nginx.conf includes, then
# runs nginx in the foreground as process 1:
#
#   KANAP_WEB_PORT       port nginx listens on inside the container, 1 to 65535 (default 80)
#   KANAP_API_UPSTREAM   host and port of the API, for example api:8080 (the default)
#
# Unset or empty means the default. An invalid value stops the container with a line that names
# the variable. The values replace the tokens of the template as text: no envsubst, which would
# also replace the VITE_* variables an env_file passes to the container, and no nginx variable in
# proxy_pass, so nginx resolves the API name once, at start, as before.
#
# The image runs as user 101 (nginx). Started as root by an older setting, the container still
# works: nginx then runs its workers as nginx and hands its temporary directories over to it.
set -eu

conf_dir=/tmp/nginx
template=/etc/nginx/default.conf.template
ipv6_flag=/proc/net/if_inet6

fail() {
  echo "docker-entrypoint.sh: $1" >&2
  exit 1
}

port=${KANAP_WEB_PORT:-80}
upstream=${KANAP_API_UPSTREAM:-api:8080}

port_error="KANAP_WEB_PORT must be a port number from 1 to 65535, not \"$port\""
case $port in
  *[!0-9]* | 0*) fail "$port_error" ;;
esac
if [ ${#port} -gt 5 ] || [ "$port" -gt 65535 ]; then
  fail "$port_error"
fi

# A host name, an IPv4 address or an IPv6 address in brackets, then an optional port. Letters,
# digits and . _ - : [ ] only: a space, a ; or a } would end the nginx directive, a $ would make
# nginx resolve the name at each request, a / would change the path sent to the API.
case $upstream in
  *[!]A-Za-z0-9._:[-]* | [!A-Za-z0-9[]*)
    fail "KANAP_API_UPSTREAM must be the host and port of the API (for example api:8080), not \"$upstream\"" ;;
esac

mkdir -p "$conf_dir" 2>/dev/null && [ -w "$conf_dir" ] ||
  fail "cannot write to $conf_dir: the container needs a writable /tmp (a tmpfs or an emptyDir volume)"

if [ "$(id -u)" = 0 ]; then
  echo 'user nginx;' >"$conf_dir/user.conf"
else
  : >"$conf_dir/user.conf"
fi

sed -e "s|__KANAP_WEB_PORT__|$port|g" -e "s|__KANAP_API_UPSTREAM__|$upstream|g" \
  "$template" >"$conf_dir/default.conf.new"
# The listen line again on [::] when the system has IPv6, as the base image's own start-up does.
if [ -f "$ipv6_flag" ]; then
  sed -i "/^[[:space:]]*listen $port;\$/{p;s/listen /listen [::]:/;}" "$conf_dir/default.conf.new"
fi
if grep -q '__KANAP_' "$conf_dir/default.conf.new"; then
  fail "$template: a token is left after the replacement"
fi
mv "$conf_dir/default.conf.new" "$conf_dir/default.conf"

exec nginx -g 'daemon off;'
