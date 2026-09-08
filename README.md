# Sélecteur de Codes CHATGPT

Widget MCP intégré à ChatGPT donnant accès à **1000 commandes prêtes à l’emploi**, avec recherche, filtres, personnalisation, génération d’images à partir d’une image de référence et export du résultat.

> Cette version publique est conçue pour être **auto-hébergée**. Chaque utilisateur déploie sa propre instance et renseigne sa propre clé OpenAI API. Aucune clé API n’est incluse dans ce dépôt.

## Fonctionnalités

- 1000 commandes ChatGPT en français
- recherche par mot-clé et filtre par catégorie
- lancement direct d’une commande depuis le widget
- ajout de contexte, objectif, ton et format
- ajout d’une image de référence
- choix du rôle de l’image : image principale, visage/identité, style, produit ou décor
- génération d’images via l’API OpenAI côté serveur
- formats 1:1, 9:16, 4:5, 16:9, 5:4 et ratios personnalisés
- recadrage final au ratio demandé
- ouverture et enregistrement de l’image, y compris sur iPhone

## Installation rapide

### 1. Déployer sur Vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FAdrienCommery%2Fselecteur-codes-chatgpt&env=OPENAI_API_KEY&envDescription=Votre%20cl%C3%A9%20OpenAI%20API%20est%20utilis%C3%A9e%20uniquement%20c%C3%B4t%C3%A9%20serveur%20pour%20les%20g%C3%A9n%C3%A9rations%20d%27images.)

Lors du déploiement, ajoutez la variable d’environnement :

```text
OPENAI_API_KEY=votre_cle_openai
```

Ne publiez jamais cette clé dans GitHub.

### 2. Récupérer l’URL MCP

Après le déploiement, votre endpoint MCP sera :

```text
https://VOTRE-PROJET.vercel.app/mcp
```

### 3. Ajouter l’app dans ChatGPT

Dans ChatGPT sur le web :

1. activez le **mode développeur** dans les paramètres des apps/plugins ;
2. ajoutez une app MCP personnalisée ;
3. utilisez l’URL `https://VOTRE-PROJET.vercel.app/mcp` ;
4. ouvrez une nouvelle conversation et lancez le Sélecteur de Codes CHATGPT.

## Clé OpenAI API

La génération d’images utilise l’API OpenAI. **Chaque installation doit utiliser sa propre clé API** et les coûts éventuels sont facturés sur le compte OpenAI correspondant.

Le widget et le catalogue de commandes ne contiennent aucune clé secrète.

## Sécurité

- ne commitez jamais de fichier `.env` ;
- conservez `OPENAI_API_KEY` uniquement dans les variables d’environnement Vercel ;
- ne partagez jamais votre clé dans un chat, une issue GitHub ou une capture d’écran ;
- si une clé est exposée, révoquez-la immédiatement et créez-en une nouvelle.

## Mise à jour

Ce dépôt constitue la version publique partageable du projet. Les évolutions du widget peuvent être publiées ici après validation sur la version de développement.

## Auteur

Créé par **Adrien Commery**.
