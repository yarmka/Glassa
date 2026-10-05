import { getApp, getApps, initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

import { CONFIG } from "./config";

const app = getApps().length ? getApp() : initializeApp(CONFIG.firebase);

export const auth = getAuth(app);
export const db = getFirestore(app);
