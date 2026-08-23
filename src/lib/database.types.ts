export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  __InternalSupabase: { PostgrestVersion: "12.2.3 (519615d)" };
  public: {
    Tables: {
      expenses: {
        Row: {
          amount: number;
          category: string;
          category_id: string | null;
          created_at: string;
          description: string;
          expense_date: string;
          id: string;
          notes: string | null;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          amount: number;
          category: string;
          category_id?: string | null;
          created_at?: string;
          description: string;
          expense_date: string;
          id?: string;
          notes?: string | null;
          updated_at?: string;
          user_id: string;
        };
        Update: Partial<Database["public"]["Tables"]["expenses"]["Insert"]>;
        Relationships: [];
      };
      categories: {
        Row: {
          color: string;
          created_at: string;
          id: string;
          is_archived: boolean;
          name: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          color?: string;
          created_at?: string;
          id?: string;
          is_archived?: boolean;
          name: string;
          updated_at?: string;
          user_id: string;
        };
        Update: Partial<Database["public"]["Tables"]["categories"]["Insert"]>;
        Relationships: [];
      };
      profiles: {
        Row: {
          avatar_url: string | null;
          created_at: string;
          currency: string;
          email: string | null;
          full_name: string | null;
          id: string;
          updated_at: string;
        };
        Insert: {
          avatar_url?: string | null;
          created_at?: string;
          currency?: string;
          email?: string | null;
          full_name?: string | null;
          id: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["profiles"]["Insert"]>;
        Relationships: [];
      };
    };
    Views: { [_ in never]: never };
    Functions: { [_ in never]: never };
    Enums: { Role: "USER" | "ADMIN" };
    CompositeTypes: { [_ in never]: never };
  };
};
