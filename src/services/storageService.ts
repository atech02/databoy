import { ref, uploadBytesResumable, getDownloadURL } from "firebase/storage";
import { storage } from "@/config/firebase";

export const storageService = {
  /**
   * Uploads a raw browser File object to a target Firebase Storage path,
   * providing optional upload progress monitoring.
   */
  async uploadVerificationDocument(
    uid: string,
    documentType: "degree_certificate" | "transcript" | "cv" | "certifications" | "publications" | "supporting_docs",
    file: File,
    onProgress?: (progress: number) => void
  ): Promise<string> {
    const timestamp = Date.now();
    const sanitizedFilename = file.name.replace(/[^a-zA-Z0-9.]/g, "_");
    const path = `verifications/${uid}/${documentType}_${timestamp}_${sanitizedFilename}`;

    try {
      const storageRef = ref(storage, path);
      const uploadTask = uploadBytesResumable(storageRef, file);

      return new Promise<string>((resolve, reject) => {
        uploadTask.on(
          "state_changed",
          (snapshot) => {
            const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
            if (onProgress) {
              onProgress(Math.round(progress));
            }
          },
          (error) => {
            console.error(`Firebase Storage upload failed for ${documentType}:`, error);
            reject(error);
          },
          async () => {
            try {
              const downloadUrl = await getDownloadURL(uploadTask.snapshot.ref);
              resolve(downloadUrl);
            } catch (err) {
              console.error("Failed to retrieve download URL:", err);
              reject(err);
            }
          }
        );
      });
    } catch (err) {
      console.error("Failed to initialize verification document upload task:", err);
      throw err;
    }
  },

  /**
   * Uploads a raw browser File to Firebase Storage under a generic folder path and id context,
   * returning the final public downloadable URL.
   */
  async uploadFile(
    folder: "assignments" | "research",
    id: string,
    file: File,
    onProgress?: (progress: number) => void
  ): Promise<{ url: string; path: string }> {
    const timestamp = Date.now();
    const sanitizedFilename = file.name.replace(/[^a-zA-Z0-9.]/g, "_");
    const path = `${folder}/${id}/${timestamp}_${sanitizedFilename}`;

    try {
      const storageRef = ref(storage, path);
      const uploadTask = uploadBytesResumable(storageRef, file);

      return new Promise<{ url: string; path: string }>((resolve, reject) => {
        uploadTask.on(
          "state_changed",
          (snapshot) => {
            const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
            if (onProgress) {
              onProgress(Math.round(progress));
            }
          },
          (error) => {
            console.error(`Firebase Storage upload failed for ${folder}/${id}:`, error);
            reject(error);
          },
          async () => {
            try {
              const downloadUrl = await getDownloadURL(uploadTask.snapshot.ref);
              resolve({ url: downloadUrl, path });
            } catch (err) {
              console.error("Failed to retrieve download URL:", err);
              reject(err);
            }
          }
        );
      });
    } catch (err) {
      console.error("Failed to initialize file upload task:", err);
      throw err;
    }
  }
};
