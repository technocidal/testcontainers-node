import admin from "firebase-admin";
import { randomUuid } from "testcontainers";
import { getImage } from "../../../testcontainers/src/utils/test-helper";
import { FirestoreEmulatorContainer, StartedFirestoreEmulatorContainer } from "./firestore-emulator-container";

const IMAGE = getImage(__dirname);

describe("FirestoreEmulatorContainer", { timeout: 240_000 }, () => {
  // firestore4 {
  it("should work using default version", async () => {
    const firestoreEmulatorContainer = await new FirestoreEmulatorContainer(IMAGE).start();

    await checkFirestore(firestoreEmulatorContainer);

    await firestoreEmulatorContainer.stop();
  });
  // }

  // firestore5 {
  it("should work using version 468.0.0", async () => {
    const firestoreEmulatorContainer = await new FirestoreEmulatorContainer(
      "gcr.io/google.com/cloudsdktool/google-cloud-cli:468.0.0-emulators"
    ).start();

    await checkFirestore(firestoreEmulatorContainer);

    await firestoreEmulatorContainer.stop();
  });

  // }

  async function checkFirestore(firestoreEmulatorContainer: StartedFirestoreEmulatorContainer) {
    expect(firestoreEmulatorContainer).toBeDefined();
    const testProjectId = "test-project";
    const testAppName = `test-app-${randomUuid()}`;
    const testCollection = "test-collection";
    const testDocument = "test-doc";
    const firebaseConfig = { projectId: testProjectId };
    const firestore = admin.initializeApp(firebaseConfig, testAppName).firestore();
    firestore.settings({ host: firestoreEmulatorContainer.getEmulatorEndpoint(), ssl: false });

    const docRef = firestore.collection(testCollection).doc(testDocument);
    await docRef.set({ message: "Hello, Firestore!" });

    const snapshot = await docRef.get();

    expect(snapshot.exists).toBeTruthy();
    expect(snapshot.data()).toEqual({ message: "Hello, Firestore!" });
  }
});
