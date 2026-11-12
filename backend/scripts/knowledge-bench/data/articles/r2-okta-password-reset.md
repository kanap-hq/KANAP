---
title: Mot de passe oublié ou compte Okta verrouillé
summary: Réinitialiser son mot de passe en libre-service et débloquer un compte Okta verrouillé.
status: published
lang: fr
---
Le mot de passe de votre compte Fromage & Co est le même pour Windows, Microsoft 365, SAP et le VPN : il est géré par **Okta**.

## Réinitialiser en libre-service

1. Sur la page de connexion `login.fromage-co.example`, cliquez sur **Mot de passe oublié ?**.
2. Choisissez la vérification par **Okta Verify** (notification sur le téléphone) ou par SMS.
3. Saisissez le nouveau mot de passe : 12 caractères au minimum, différent des 5 précédents.

Le nouveau mot de passe est actif tout de suite pour Microsoft 365 ; comptez 15 minutes pour SAP. Pensez à le mettre à jour dans les applications qui l'ont mémorisé (FortiClient, Outlook sur téléphone).

## Compte verrouillé

Après **5 tentatives erronées**, Okta verrouille le compte pendant 30 minutes et la page affiche le message `E0000119 : Account locked`. Deux solutions :

- attendre 30 minutes, puis utiliser **Mot de passe oublié ?** ;
- appeler le service desk (poste 4400), qui peut déverrouiller immédiatement après vérification de votre identité.

## Mot de passe expiré

Les mots de passe expirent tous les 180 jours. Okta prévient 14 jours avant par une bannière à la connexion. Un mot de passe expiré se change depuis la même page, sans intervention du service desk.
