import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  where,
  type Unsubscribe,
} from "firebase/firestore";

import { auth, db } from "./firebase";

export type Review = {
  id: string;
  gameId: string;
  uid: string;
  name: string;
  stars: number;
  comment: string;
  createdAt?: { toDate?: () => Date } | null;
};

export function watchReviews(
  gameId: string,
  onChange: (reviews: Review[]) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  return onSnapshot(
    query(collection(db, "reviews"), where("gameId", "==", gameId)),
    (snapshot) =>
      onChange(
        snapshot.docs
          .map((item) => ({
            ...(item.data() as Omit<Review, "id">),
            id: item.id,
          }))
          .sort(
            (a, b) =>
              (b.createdAt?.toDate?.().getTime() ?? 0) -
              (a.createdAt?.toDate?.().getTime() ?? 0),
          ),
      ),
    onError,
  );
}

export async function saveReview(input: {
  gameId: string;
  name: string;
  stars: number;
  comment: string;
}) {
  const user = auth.currentUser;
  if (!user) throw new Error("Sign in to leave a review.");
  if (!Number.isInteger(input.stars) || input.stars < 1 || input.stars > 5) {
    throw new Error("Choose a rating from 1 to 5 stars.");
  }
  if (input.comment.length > 300) {
    throw new Error("Reviews must be 300 characters or fewer.");
  }
  const unlock = await getDoc(doc(db, "unlocks", `${user.uid}_${input.gameId}`));
  if (!unlock.exists()) {
    throw new Error("Only customers who purchased this game can leave a review.");
  }
  const reviewRef = doc(db, "reviews", `${input.gameId}_${user.uid}`);
  await setDoc(
    reviewRef,
    {
      gameId: input.gameId,
      uid: user.uid,
      name: input.name.trim().slice(0, 40),
      stars: input.stars,
      comment: input.comment.trim(),
      createdAt: serverTimestamp(),
    },
    { merge: true },
  );
}

export async function removeReview(gameId: string) {
  const user = auth.currentUser;
  if (!user) throw new Error("Sign in to continue.");
  await deleteDoc(doc(db, "reviews", `${gameId}_${user.uid}`));
}

export async function reportBrokenLink(gameId: string, gameTitle: string) {
  const user = auth.currentUser;
  if (!user) throw new Error("Sign in to continue.");
  const reportId = `${gameId}_${user.uid}`;
  const report = await getDoc(doc(db, "linkReports", reportId));
  if (report.exists()) return;
  await setDoc(doc(db, "linkReports", reportId), {
    gameId,
    uid: user.uid,
    gameTitle,
    createdAt: serverTimestamp(),
  });
}

export async function dismissPopup(popupId: string) {
  const storageKey = "glassa.dismissed-popups";
  const dismissed = new Set<string>(
    JSON.parse(localStorage.getItem(storageKey) ?? "[]") as string[],
  );
  dismissed.add(popupId);
  localStorage.setItem(storageKey, JSON.stringify([...dismissed]));
  const user = auth.currentUser;
  if (user) {
    const userRef = doc(db, "users", user.uid);
    await setDoc(userRef, { dismissedPopups: [popupId] }, { merge: true });
  }
}
