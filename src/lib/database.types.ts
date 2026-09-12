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
      investment_accounts: {
        Row: {
          broker_id: string;
          id: string;
          user_id: string;
        };
        Insert: {
          broker_id: string;
          id?: string;
          user_id: string;
        };
        Update: Partial<Database["public"]["Tables"]["investment_accounts"]["Insert"]>;
        Relationships: [];
      };
      investment_transactions: {
        Row: {
          amount: number;
          currency: string;
          executed_at: string;
          id: string;
          instrument: string;
          investment_account_id: string;
          quantity: number;
          side: string;
          unit_price: number;
        };
        Insert: {
          amount: number;
          currency: string;
          executed_at: string;
          id?: string;
          instrument: string;
          investment_account_id: string;
          quantity: number;
          side: string;
          unit_price: number;
        };
        Update: Partial<Database["public"]["Tables"]["investment_transactions"]["Insert"]>;
        Relationships: [];
      };
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
    Functions: {
      get_expense_dashboard: {
        Args: {
          p_analytics_end_exclusive: string;
          p_analytics_start: string;
          p_current_end_exclusive: string;
          p_current_start: string;
        };
        Returns: Json;
      };
    };
    Enums: { Role: "USER" | "ADMIN" };
    CompositeTypes: { [_ in never]: never };
  };
};
