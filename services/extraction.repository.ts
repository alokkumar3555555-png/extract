import "server-only";
import { FieldValue, Timestamp, type DocumentSnapshot } from "firebase-admin/firestore";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { validateExtractionPayload } from "@/lib/validation";
import type { ExtractionResult, StoredExtraction } from "@/types/extraction";

function serialize(snapshot: DocumentSnapshot): StoredExtraction {
  const value = snapshot.data();
  if (!value || !(value.createdAt instanceof Timestamp)) throw new Error("Invalid stored extraction");
  return {
    ...validateExtractionPayload({
      idType: value.idType, name: value.name, documentNumber: value.documentNumber,
      address: value.address, phoneNumber: value.phoneNumber,
    }),
    id: snapshot.id,
    userId: typeof value.userId === "string" ? value.userId : null,
    createdAt: value.createdAt.toDate().toISOString(),
  };
}

export async function saveExtraction(data: ExtractionResult, userId: string | null = null) {
  const reference = getAdminFirestore().collection("extractions").doc();
  // Whitelist again at the storage boundary; never persist images or caller metadata.
  await reference.set({ ...validateExtractionPayload(data), userId, createdAt: FieldValue.serverTimestamp() });
  return serialize(await reference.get());
}

// A trusted authentication layer can supply userId later; never accept it from client JSON.
export async function listExtractions(userId?: string): Promise<StoredExtraction[]> {
  const collection = getAdminFirestore().collection("extractions");
  const query = userId === undefined ? collection : collection.where("userId", "==", userId);
  const snapshot = await query.orderBy("createdAt", "desc").get();
  return snapshot.docs.map(serialize);
}

export async function getExtraction(id: string): Promise<StoredExtraction | null> {
  const snapshot = await getAdminFirestore().collection("extractions").doc(id).get();
  return snapshot.exists ? serialize(snapshot) : null;
}

export async function deleteExtraction(id: string): Promise<boolean> {
  const database = getAdminFirestore();
  const reference = database.collection("extractions").doc(id);
  return database.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference);
    if (!snapshot.exists) return false;
    transaction.delete(reference);
    return true;
  });
}
