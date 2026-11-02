# Guide VPN et accès à distance

Tout accès à distance au réseau Fromage & Co passe par **FortiClient VPN** avec **Okta MFA**. La passerelle VPN est hébergée sur le cluster FortiGate du datacenter de Paris (PAR-DC1).

## Demander un accès VPN

1. Ouvrez une demande dans ServiceNow sous **IT > Access > VPN**.
2. Votre manager approuve la demande ; Informatique et digital crée le profil.
3. Vous recevez un e-mail avec le lien d'installation de FortiClient et l'adresse de la passerelle (`vpn.fromage-co.example`).

Le délai standard est de **1 jour ouvré**. Le personnel de Production et de Qualité reçoit automatiquement l'accès au segment réseau de l'usine.

## Se connecter

1. Lancez FortiClient et sélectionnez le profil **Fromage & Co**.
2. Saisissez votre e-mail professionnel et votre mot de passe.
3. Approuvez la notification Okta sur votre téléphone.

## Problèmes fréquents

- **« Identifiants refusés » après un changement de mot de passe** — FortiClient garde votre ancien mot de passe en cache. Cliquez sur *Disconnect*, puis effacez le mot de passe enregistré dans les paramètres du profil et saisissez le nouveau. C'est le ticket VPN le plus fréquent.
- **Aucune notification Okta reçue** — ouvrez l'application Okta Verify manuellement ; si le téléphone a été remplacé, demandez au centre de services de réinitialiser votre facteur MFA.
- **Connecté mais SAP inaccessible** — le segment usine exige le groupe VPN *Production*. Vérifiez avec le centre de services que votre profil l'inclut.

## Télétravail

Le VPN est nécessaire pour SAP, les partages de fichiers et le Cave Monitoring Dashboard. Microsoft 365 (Teams, Exchange, SharePoint) fonctionne sans VPN. Déconnectez le VPN quand vous n'utilisez que Teams — la capacité du tunnel est partagée, et les vendredis matin sont déjà assez chargés dans les caves.
