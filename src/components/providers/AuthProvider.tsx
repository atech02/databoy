"use client";

import React, { createContext, useContext, useEffect, useState, useRef } from "react";
import { 
  User, 
  signOut, 
  signInWithPopup, 
  GoogleAuthProvider, 
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile
} from "firebase/auth";
import { auth } from "@/config/firebase";
import { UserProfile } from "@/types/domain";
import { userService } from "@/services/userService";

interface AuthContextType {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  error: string | null;
  loginWithGoogle: () => Promise<void>;
  loginWithEmail: (email: string, password: string) => Promise<void>;
  registerWithEmail: (email: string, password: string, name: string, role: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  retryFetchProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Timeout helper utility to abort hanging database requests
function promiseWithTimeout<T>(promise: Promise<T>, ms: number, timeoutErrorMsg: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(timeoutErrorMsg)), ms)
    )
  ]);
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fix 3 — Guard flag: prevents fetchProfile from creating a fallback customer
  // profile when registerWithEmail is actively creating the real profile.
  // useRef so the value is available synchronously across async callbacks
  // without triggering re-renders.
  const justRegisteredRef = useRef(false);

  const fetchProfile = async (uid: string, email: string, name: string) => {
    console.log(`[PROFILE_FETCH_START] Starting profile fetch for uid: ${uid}`);
    try {
      setError(null);
      let userProf = await promiseWithTimeout(
        userService.getUserProfile(uid),
        8000,
        "Database connection lookup timed out (8s limit exceeded)."
      );
      if (!userProf) {
        // Fix 3 — If registerWithEmail is in progress, it will handle profile
        // creation with the correct role. Do NOT create a fallback customer here.
        if (justRegisteredRef.current) {
          console.log(`[AuthProvider] Profile not found for ${uid}, but registration is in progress. Skipping fallback.`);
          return;
        }
        console.log(`[AuthProvider] Profile not found for ${uid}. Creating default customer profile.`);
        // Fallback: for Google sign-in or returning users whose profile was deleted
        userProf = await userService.createUserProfile({
          uid,
          email,
          displayName: name || "DataBoy User",
          role: "customer",
          status: "active",
          isOnboarded: false,
          profileCompletion: 20
        });
      }
      console.log("[PROFILE_FETCH_SUCCESS] User profile loaded successfully from Firestore:", userProf);
      console.log(`[ROLE_RESOLVED] Profile role resolved as: "${userProf?.role}"`);
      setProfile(userProf);
    } catch (err: any) {
      console.error("[AuthProvider] Profile fetch failure:", err);
      setError(err?.message || "Failed to load authenticated user profile.");
      setProfile(null);
    }
  };

  useEffect(() => {
    console.log("[AUTH_START] Initializing Firebase Auth observer");
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      console.log("[AUTH_SUCCESS] Firebase Auth state changed. currentUser UID:", currentUser?.uid);
      setLoading(true);
      setUser(currentUser);
      if (currentUser) {
        await fetchProfile(
          currentUser.uid, 
          currentUser.email || "", 
          currentUser.displayName || ""
        );
      } else {
        console.log("[AuthProvider] No authenticated user. Clearing profile.");
        setProfile(null);
        setError(null);
      }
      setLoading(false);
      console.log("[AuthProvider] AuthStateChanged handling complete. loading = false");
    });

    return () => unsubscribe();
  }, []);

  const loginWithGoogle = async () => {
    setLoading(true);
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error("Error signing in with Google:", error);
      setLoading(false);
      throw error;
    }
  };

  const loginWithEmail = async (email: string, password: string) => {
    setLoading(true);
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (error) {
      console.error("Error signing in with email:", error);
      setLoading(false);
      throw error;
    }
  };

  const registerWithEmail = async (email: string, password: string, name: string, role: string) => {
    setLoading(true);
    // Fix 3 — Signal that registration is in progress so fetchProfile
    // does not race and create a fallback customer profile.
    justRegisteredRef.current = true;
    try {
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      await updateProfile(userCredential.user, { displayName: name });
      
      // Fix 1 — Writer/Proofreader roles need verificationStatus in the initial
      // document, otherwise the Firestore allow create rule denies the write
      // (rule requires role == 'customer' OR verificationStatus in ['pending_review', 'draft', 'incomplete']).
      const isSpecialist = role !== "customer" && role !== "admin";
      const userProf = await userService.createUserProfile({
        uid: userCredential.user.uid,
        email,
        displayName: name,
        role: role as any,
        status: "active",
        isOnboarded: false,
        profileCompletion: 20,
        ...(isSpecialist ? { verificationStatus: "draft" as any } : {})
      });
      setProfile(userProf);
      justRegisteredRef.current = false;
    } catch (error) {
      console.error("Error registering with email:", error);
      justRegisteredRef.current = false;
      setLoading(false);
      throw error;
    }
  };

  const logout = async () => {
    setLoading(true);
    try {
      await signOut(auth);
    } catch (error) {
      console.error("Error signing out:", error);
      setLoading(false);
      throw error;
    }
  };

  const refreshProfile = async () => {
    if (user) {
      console.log("[AuthProvider] Profile refresh start for uid:", user.uid);
      try {
        setError(null);
        const userProf = await promiseWithTimeout(
          userService.getUserProfile(user.uid),
          8000,
          "Database connection lookup timed out (8s limit exceeded)."
        );
        if (userProf) {
          console.log("[AuthProvider] Profile refresh success:", userProf);
          console.log("[AuthProvider] Role resolved on refresh:", userProf?.role);
          setProfile(userProf);
        } else {
          console.log("[AuthProvider] Profile refresh returned null.");
        }
      } catch (err: any) {
        console.error("[AuthProvider] Profile refresh failure:", err);
        setError(err?.message || "Failed to refresh user profile from database.");
      }
    } else {
      console.log("[AuthProvider] refreshProfile called but user is null.");
    }
  };

  const retryFetchProfile = async () => {
    if (user) {
      console.log("[AuthProvider] Retrying profile fetch for uid:", user.uid);
      setLoading(true);
      await fetchProfile(
        user.uid,
        user.email || "",
        user.displayName || ""
      );
      setLoading(false);
      console.log("[AuthProvider] Retry complete. loading = false");
    } else {
      console.log("[AuthProvider] retryFetchProfile called but user is null.");
    }
  };

  if (error && !profile && !loading) {
    console.log("[AuthProvider] Rendering Connection Error Screen");
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0B0F19] p-6 text-foreground">
        <div className="max-w-md w-full bg-card/45 backdrop-blur-md border border-amber-500/20 p-8 rounded-2xl shadow-[0_0_30px_rgba(245,158,11,0.1)] flex flex-col items-center text-center gap-6">
          <div className="w-16 h-16 bg-amber-500/10 rounded-full flex items-center justify-center text-3xl border border-amber-500/25 animate-pulse text-amber-500">
            ⚠️
          </div>
          <div className="flex flex-col gap-2 animate-fade-in">
            <h2 className="text-xl font-bold tracking-tight text-white">Database Connection Failed</h2>
            <p className="text-xs text-muted-foreground leading-relaxed">
              We encountered a network or database connection issue while retrieving your profile. Please check your internet connection and try again.
            </p>
            {error && (
              <div className="mt-2 bg-red-500/10 text-red-400 text-xs font-mono p-3 rounded-lg border border-red-500/20 max-h-24 overflow-y-auto w-full text-left">
                {error}
              </div>
            )}
          </div>
          <div className="flex flex-col sm:flex-row gap-3 w-full mt-2">
            <button
              onClick={retryFetchProfile}
              className="flex-1 py-2.5 px-4 bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-700 hover:to-orange-700 text-white font-bold text-sm rounded-xl transition-all duration-300 shadow-[0_4px_12px_rgba(245,158,11,0.2)] cursor-pointer"
            >
              🔄 Retry Connection
            </button>
            <button
              onClick={logout}
              className="py-2.5 px-4 bg-slate-800 hover:bg-slate-700 text-white font-bold text-sm rounded-xl transition-all duration-300 border border-slate-700 cursor-pointer"
            >
              Logout
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <AuthContext.Provider value={{ 
      user, 
      profile, 
      loading, 
      error, 
      loginWithGoogle, 
      loginWithEmail, 
      registerWithEmail, 
      logout, 
      refreshProfile,
      retryFetchProfile
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
