# Déploiement sur VM (rapide)

Ce fichier décrit les étapes minimales pour déployer l'API `coach-financier-backend` sur une VM Linux (Debian/Ubuntu).

1) Transférer le dépôt sur la VM

 - Sur votre machine locale, depuis le dossier `coach-financier-backend` :

```bash
# depuis le dossier du backend
git init
git add .
git commit -m "prepare vm deploy"
# pousser vers le remote que vous avez configuré sur la VM (ou clone via SSH depuis la VM)
```

2) Installer Docker (recommandé) ou Node.js

Docker (Ubuntu/Debian):

```bash
sudo apt update
sudo apt install -y ca-certificates curl gnupg lsb-release
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io
sudo usermod -aG docker $USER
```

Node.js (si vous n'utilisez pas Docker):

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs build-essential
```

3) Préparer les variables d'environnement

 - Copier ` .env.example ` en `.env` et compléter les valeurs (notamment `MONGODB_URI`).

4) Démarrer l'application

 - Avec Docker (recommandé) :

```bash
./start.sh docker
```

 - Sans Docker :

```bash
./start.sh node
```

5) Exposer le port

 - Ouvrez le port `3000` sur la VM (firewall/cloud provider) et configurez un reverse-proxy (nginx) + TLS si besoin.

6) Optionnel: systemd

 - Vous pouvez créer une unité systemd qui lance `./start.sh node` ou un conteneur Docker via `ExecStart`.

7) Logs et supervision

 - Docker : `docker logs -f finavii-api`
 - Node : démarrez avec `pm2 start serve.js --name finavii` ou utilisez `systemd`.

Contactez-moi si vous voulez que je crée aussi le fichier `nginx`/`systemd` prêt-à-l'emploi.
