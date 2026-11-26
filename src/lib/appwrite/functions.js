import { Functions } from 'appwrite'
import { client } from './client.js'

/**
 * Appwrite Functions service. This is how the browser asks TRUSTED backend code to do things it
 * is not allowed to do itself (create profiles, change roles). The function authenticates the
 * caller and applies the real permission rules; the browser only supplies the request.
 */
export const functions = new Functions(client)
