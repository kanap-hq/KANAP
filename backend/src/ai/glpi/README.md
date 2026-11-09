# GLPI connection URLs

Configure the installation URL, for example `https://glpi.example.com/helpdesk`,
or its legacy API base, `https://glpi.example.com/helpdesk/apirest.php`.
Kadratis uses the legacy REST API with user and optional application tokens.

The settings service and runtime client share URL path normalization. Copied
routes such as `/apirest.php/initSession` (including lowercase `initsession`)
and `/api.php/v1/initSession` are reduced to the installation root. Existing
stored URLs and connection-test overrides receive the same normalization.
All outgoing API routes are then constructed under `/apirest.php`, preserving
any installation subdirectory. This does not add support for the OAuth V2 API.

Session initialization calls `/apirest.php/initSession` with
`Authorization: user_token ...` and optional `App-Token`. Subsequent calls use
`Session-Token` and the same optional `App-Token`.

An incorrect URL such as `/apirest.php/initsession` previously resulted in
`/apirest.php/initsession/apirest.php/initSession`. GLPI can respond with
`ERROR_SESSION_TOKEN_MISSING` because `initsession` is not its `initSession`
endpoint. On versions without this normalization fix, remove the
endpoint suffix from the configured URL, save, and test again. No application
restart is required for settings saved through Kadratis.

References: [GLPI REST API V1](https://help.glpi-project.org/documentation/modules/configuration/general/api/api)
and [GLPI 11 request routing](https://github.com/glpi-project/glpi/blob/11.0/bugfixes/src/Glpi/Api/APIRest.php).
