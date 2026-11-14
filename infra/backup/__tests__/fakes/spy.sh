# Sourced by each fake: notes which settings and which rclone key pairs reached the process
# environment, and whether the lock descriptor (fd 9) leaked into it.
printf '%s|%s|%s\n' "$1" \
  "$(env | grep -oE '^((BACKUP|ATTACHMENTS|HETZNER|RESTORE)_[A-Z0-9_]*|RCLONE_CONFIG_[A-Z]+_SECRET_ACCESS_KEY)=' | tr -d '=' | sort | tr '\n' ' ')" \
  "$([[ -e /proc/$$/fd/9 ]] && echo fd9)" >> "$FAKE_DIR/spy"
