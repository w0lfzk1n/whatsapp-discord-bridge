#!/bin/bash

# Name of the pm2 process (change this to whatever you want)
APP_NAME="bot"

# Path to your Node.js app
APP_PATH="index.js"

# Start or restart the app with pm2 using the custom name
pm2 start "$APP_PATH" --name "$APP_NAME" --update-env

# Save the pm2 process list so it restarts on reboot
pm2 save
pm2 logs
