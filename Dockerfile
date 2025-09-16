FROM apify/actor-node-playwright-chrome:latest
# pinned via tag; CI builds on Apify will use this base image

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm ci --quiet --ignore-scripts --legacy-peer-deps

COPY . ./

CMD ["npm", "start"]
