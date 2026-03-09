FROM apify/actor-node-playwright-chrome:latest

WORKDIR /usr/src/app

COPY package*.json ./

USER root
RUN chown -R myuser:myuser /usr/src/app
USER myuser

RUN npm install --production

COPY . ./

CMD ["node", "src/main.js"]