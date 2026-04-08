import { initializeApp } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-app.js";
import {
  getFirestore, collection, doc, setDoc, getDoc, getDocs,
  addDoc, updateDoc, deleteDoc, onSnapshot, query, where, writeBatch
} from "https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey:            "AIzaSyDoQ2HUB5jgiKV07p7ZIKcbQDBNrHYAGso",
  authDomain:        "homebase-9d3d7.firebaseapp.com",
  projectId:         "homebase-9d3d7",
  storageBucket:     "homebase-9d3d7.firebasestorage.app",
  messagingSenderId: "978326124685",
  appId:             "1:978326124685:web:92e6acd7a5b56fb50a8ac4",
  measurementId:     "G-6NCJLZ3ZH4"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);

export {
  collection, doc, setDoc, getDoc, getDocs,
  addDoc, updateDoc, deleteDoc, onSnapshot, query, where, writeBatch
};
