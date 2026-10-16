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
      account_notices: {
        Row: {
          created_at: string;
          family_name: string;
          id: string;
          kind: string;
          seen_at: string | null;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          family_name: string;
          id?: string;
          kind: string;
          seen_at?: string | null;
          user_id: string;
        };
        Update: Partial<Database["public"]["Tables"]["account_notices"]["Insert"]>;
        Relationships: [];
      };
      expense_tabs: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          category_keys: string[];
          subtype_keys: string[];
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          name: string;
          category_keys?: string[];
          subtype_keys?: string[];
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["expense_tabs"]["Insert"]>;
        Relationships: [];
      };
      families: {
        Row: {
          created_at: string;
          creator_id: string;
          id: string;
          name: string;
        };
        Insert: {
          created_at?: string;
          creator_id: string;
          id?: string;
          name: string;
        };
        Update: Partial<Database["public"]["Tables"]["families"]["Insert"]>;
        Relationships: [];
      };
      family_members: {
        Row: {
          family_id: string;
          id: string;
          joined_at: string;
          last_active_at: string | null;
          role: string;
          user_id: string;
        };
        Insert: {
          family_id: string;
          id?: string;
          joined_at?: string;
          last_active_at?: string | null;
          role: string;
          user_id: string;
        };
        Update: Partial<Database["public"]["Tables"]["family_members"]["Insert"]>;
        Relationships: [];
      };
      member_permissions: {
        Row: {
          level: string;
          member_id: string;
          module: string;
        };
        Insert: {
          level: string;
          member_id: string;
          module: string;
        };
        Update: Partial<Database["public"]["Tables"]["member_permissions"]["Insert"]>;
        Relationships: [];
      };
      net_worth_items: {
        Row: {
          archived_at: string | null;
          category: string;
          currency: string;
          id: string;
          kind: string;
          name: string;
          purchase_amount: number | string | null;
          user_id: string;
        };
        Insert: {
          archived_at?: string | null;
          category: string;
          currency: string;
          id?: string;
          kind: string;
          name: string;
          purchase_amount?: number | string | null;
          user_id: string;
        };
        Update: Partial<Database["public"]["Tables"]["net_worth_items"]["Insert"]>;
        Relationships: [];
      };
      net_worth_valuations: {
        Row: {
          id: string;
          item_id: string;
          value: number | string;
          valued_on: string;
        };
        Insert: {
          id?: string;
          item_id: string;
          value: number | string;
          valued_on: string;
        };
        Update: Partial<Database["public"]["Tables"]["net_worth_valuations"]["Insert"]>;
        Relationships: [];
      };
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
          amount: number | string;
          currency: string;
          executed_at: string;
          id: string;
          instrument: string;
          investment_account_id: string;
          quantity: number | string;
          side: string;
          unit_price: number | string;
        };
        Insert: {
          amount: number | string;
          currency: string;
          executed_at: string;
          id?: string;
          instrument: string;
          investment_account_id: string;
          quantity: number | string;
          side: string;
          unit_price: number | string;
        };
        Update: Partial<Database["public"]["Tables"]["investment_transactions"]["Insert"]>;
        Relationships: [];
      };
      expenses: {
        Row: {
          amount: number;
          category: string;
          subtype: string | null;
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
          subtype?: string | null;
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
          display_name: string | null;
          email: string | null;
          full_name: string | null;
          id: string;
          managed_by_family: string | null;
          must_change_password: boolean;
          updated_at: string;
          username: string | null;
        };
        Insert: {
          avatar_url?: string | null;
          created_at?: string;
          currency?: string;
          display_name?: string | null;
          email?: string | null;
          full_name?: string | null;
          id: string;
          managed_by_family?: string | null;
          must_change_password?: boolean;
          updated_at?: string;
          username?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["profiles"]["Insert"]>;
        Relationships: [];
      };
    };
    Views: { [_ in never]: never };
    Functions: {
      add_managed_kid: {
        Args: {
          p_permissions: Json;
          p_user_id: string;
        };
        Returns: string;
      };
      complete_password_change: {
        Args: never;
        Returns: undefined;
      };
      create_family: {
        Args: {
          p_name: string;
        };
        Returns: string;
      };
      create_net_worth_item_with_valuation: {
        Args: {
          p_category: string;
          p_currency: string;
          p_kind: string;
          p_name: string;
          p_purchase_amount: number | string | null;
          p_value: number | string;
          p_valued_on: string;
        };
        Returns: string;
      };
      delete_family: {
        Args: { p_confirm_name: string };
        Returns: undefined;
      };
      dismiss_notice: {
        Args: { p_notice_id: string };
        Returns: undefined;
      };
      get_expense_dashboard: {
        Args: {
          p_analytics_end_exclusive: string;
          p_analytics_start: string;
          p_current_end_exclusive: string;
          p_current_start: string;
          p_user_id?: string;
        };
        Returns: Json;
      };
      get_family: {
        Args: never;
        Returns: Json;
      };
      get_my_membership: {
        Args: never;
        Returns: {
          family_id: string;
          family_name: string;
          is_creator: boolean;
          member_id: string;
          permissions: Json;
          role: string;
        }[];
      };
      get_my_notices: {
        Args: never;
        Returns: {
          created_at: string;
          family_name: string;
          id: string;
          kind: string;
        }[];
      };
      remove_family_member: {
        Args: { p_member_id: string };
        Returns: undefined;
      };
      require_password_change: {
        Args: { p_member_id: string };
        Returns: string;
      };
      set_member_permissions: {
        Args: {
          p_member_id: string;
          p_permissions: Json;
        };
        Returns: undefined;
      };
      touch_last_active: {
        Args: never;
        Returns: undefined;
      };
    };
    Enums: { Role: "USER" | "ADMIN" };
    CompositeTypes: { [_ in never]: never };
  };
};
