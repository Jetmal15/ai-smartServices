import { Storage } from 'appwrite'
import { client } from './client.js'

/** Appwrite Storage: used only to UPLOAD a complaint attachment. The complaint-api function verifies it afterwards. */
export const storage = new Storage(client)
