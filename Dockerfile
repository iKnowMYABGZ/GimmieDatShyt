FROM apify/actor-node-playwright-chrome:latest

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm ci --quiet --ignore-scripts --legacy-peer-deps

COPY . ./

CMD ["npm", "start"]
