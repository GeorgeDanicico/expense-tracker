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
      calendar_event_attendees: {
        Row: {
          event_id: string;
          member_id: string;
        };
        Insert: {
          event_id: string;
          member_id: string;
        };
        Update: Partial<Database["public"]["Tables"]["calendar_event_attendees"]["Insert"]>;
        Relationships: [];
      };
      calendar_events: {
        Row: {
          all_day: boolean;
          created_at: string;
          created_by: string | null;
          ends_at: string;
          family_id: string;
          id: string;
          location: string;
          notes: string;
          notified_at: string | null;
          notify_at: string | null;
          notify_locked_until: string | null;
          series_id: string;
          series_index: number;
          series_repeat: string;
          starts_at: string;
          timezone: string;
          title: string;
          updated_at: string;
        };
        Insert: {
          all_day?: boolean;
          created_at?: string;
          created_by?: string | null;
          ends_at: string;
          family_id: string;
          id?: string;
          location?: string;
          notes?: string;
          notified_at?: string | null;
          notify_at?: string | null;
          notify_locked_until?: string | null;
          series_id?: string;
          series_index?: number;
          series_repeat?: string;
          starts_at: string;
          timezone?: string;
          title: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["calendar_events"]["Insert"]>;
        Relationships: [];
      };
      calendar_feeds: {
        Row: {
          created_at: string;
          id: string;
          last_fetched_at: string | null;
          revoked_at: string | null;
          token_hash: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          last_fetched_at?: string | null;
          revoked_at?: string | null;
          token_hash: string;
          user_id: string;
        };
        Update: Partial<Database["public"]["Tables"]["calendar_feeds"]["Insert"]>;
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
      family_invites: {
        Row: {
          code_hash: string;
          created_at: string;
          created_by: string | null;
          expires_at: string;
          family_id: string;
          id: string;
          permissions: Json | null;
          revoked_at: string | null;
          role: string;
          used_at: string | null;
          used_by: string | null;
        };
        Insert: {
          code_hash: string;
          created_at?: string;
          created_by?: string | null;
          expires_at: string;
          family_id: string;
          id?: string;
          permissions?: Json | null;
          revoked_at?: string | null;
          role: string;
          used_at?: string | null;
          used_by?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["family_invites"]["Insert"]>;
        Relationships: [];
      };
      family_members: {
        Row: {
          color: number | null;
          family_id: string;
          id: string;
          joined_at: string;
          last_active_at: string | null;
          role: string;
          user_id: string;
        };
        Insert: {
          color?: number | null;
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
      import_batches: {
        Row: {
          confirmed_at: string | null;
          confirmed_count: number | null;
          content_hash: string;
          created_at: string;
          currency: string | null;
          expires_at: string | null;
          id: string;
          parser_id: string;
          period_end: string | null;
          period_start: string | null;
          row_count: number;
          skipped_credits: number;
          source_kind: string;
          status: string;
          undone_at: string | null;
          user_id: string;
        };
        Insert: {
          confirmed_at?: string | null;
          confirmed_count?: number | null;
          content_hash: string;
          created_at?: string;
          currency?: string | null;
          expires_at?: string | null;
          id?: string;
          parser_id: string;
          period_end?: string | null;
          period_start?: string | null;
          row_count: number;
          skipped_credits?: number;
          source_kind: string;
          status?: string;
          undone_at?: string | null;
          user_id: string;
        };
        Update: Partial<Database["public"]["Tables"]["import_batches"]["Insert"]>;
        Relationships: [];
      };
      import_expenses: {
        Row: {
          batch_id: string;
          expense_id: string;
        };
        Insert: {
          batch_id: string;
          expense_id: string;
        };
        Update: Partial<Database["public"]["Tables"]["import_expenses"]["Insert"]>;
        Relationships: [];
      };
      import_rows: {
        Row: {
          amount: number;
          batch_id: string;
          category: string;
          currency: string;
          description: string;
          expense_date: string;
          id: string;
          notes: string | null;
          position: number;
          rule_matched: boolean;
          subtype: string | null;
        };
        Insert: {
          amount: number;
          batch_id: string;
          category?: string;
          currency: string;
          description: string;
          expense_date: string;
          id?: string;
          notes?: string | null;
          position: number;
          rule_matched?: boolean;
          subtype?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["import_rows"]["Insert"]>;
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
      mcp_tokens: {
        Row: {
          created_at: string;
          expires_at: string | null;
          id: string;
          last_used_at: string | null;
          name: string;
          prefix: string;
          regenerated_at: string | null;
          revoked_at: string | null;
          token_hash: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          expires_at?: string | null;
          id?: string;
          last_used_at?: string | null;
          name: string;
          prefix: string;
          regenerated_at?: string | null;
          revoked_at?: string | null;
          token_hash: string;
          user_id: string;
        };
        Update: Partial<Database["public"]["Tables"]["mcp_tokens"]["Insert"]>;
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
      notification_settings: {
        Row: {
          calendar_enabled: boolean;
          push_enabled: boolean;
          reminders_enabled: boolean;
          todos_enabled: boolean;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          calendar_enabled?: boolean;
          push_enabled?: boolean;
          reminders_enabled?: boolean;
          todos_enabled?: boolean;
          updated_at?: string;
          user_id: string;
        };
        Update: Partial<Database["public"]["Tables"]["notification_settings"]["Insert"]>;
        Relationships: [];
      };
      notifications: {
        Row: {
          attempts: number;
          created_at: string;
          dedupe_key: string | null;
          id: string;
          kind: string;
          last_error: string | null;
          locked_until: string | null;
          payload: Json;
          send_at: string;
          sent_at: string | null;
          status: string;
          user_id: string;
        };
        Insert: {
          attempts?: number;
          created_at?: string;
          dedupe_key?: string | null;
          id?: string;
          kind: string;
          last_error?: string | null;
          locked_until?: string | null;
          payload: Json;
          send_at?: string;
          sent_at?: string | null;
          status?: string;
          user_id: string;
        };
        Update: Partial<Database["public"]["Tables"]["notifications"]["Insert"]>;
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
          avatar_path: string | null;
          avatar_url: string | null;
          created_at: string;
          currency: string;
          display_name: string | null;
          email: string | null;
          full_name: string | null;
          id: string;
          managed_by_family: string | null;
          mcp_enabled: boolean;
          must_change_password: boolean;
          updated_at: string;
          username: string | null;
        };
        Insert: {
          avatar_path?: string | null;
          avatar_url?: string | null;
          created_at?: string;
          currency?: string;
          display_name?: string | null;
          email?: string | null;
          full_name?: string | null;
          id: string;
          managed_by_family?: string | null;
          mcp_enabled?: boolean;
          must_change_password?: boolean;
          updated_at?: string;
          username?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["profiles"]["Insert"]>;
        Relationships: [];
      };
      push_subscriptions: {
        Row: {
          auth: string;
          created_at: string;
          endpoint: string;
          id: string;
          last_success_at: string | null;
          p256dh: string;
          user_agent: string;
          user_id: string;
        };
        Insert: {
          auth: string;
          created_at?: string;
          endpoint: string;
          id?: string;
          last_success_at?: string | null;
          p256dh: string;
          user_agent?: string;
          user_id: string;
        };
        Update: Partial<Database["public"]["Tables"]["push_subscriptions"]["Insert"]>;
        Relationships: [];
      };
      reminder_completions: {
        Row: {
          done_at: string;
          expense_id: string | null;
          id: string;
          occurrence_on: string;
          reminder_id: string;
        };
        Insert: {
          done_at?: string;
          expense_id?: string | null;
          id?: string;
          occurrence_on: string;
          reminder_id: string;
        };
        Update: Partial<Database["public"]["Tables"]["reminder_completions"]["Insert"]>;
        Relationships: [];
      };
      reminders: {
        Row: {
          created_at: string;
          expense_template: Json | null;
          id: string;
          lead_minutes: number[];
          next_due_at: string | null;
          next_due_on: string | null;
          next_notify_at: string | null;
          notes: string;
          notifications_muted: boolean;
          notify_locked_until: string | null;
          repeat_interval: number;
          repeat_unit: string;
          snoozed_until: string | null;
          starts_on: string;
          time_of_day: string;
          timezone: string;
          title: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          expense_template?: Json | null;
          id?: string;
          lead_minutes?: number[];
          next_due_at?: string | null;
          next_due_on?: string | null;
          next_notify_at?: string | null;
          notes?: string;
          notifications_muted?: boolean;
          notify_locked_until?: string | null;
          repeat_interval?: number;
          repeat_unit?: string;
          snoozed_until?: string | null;
          starts_on: string;
          time_of_day?: string;
          timezone?: string;
          title: string;
          updated_at?: string;
          user_id: string;
        };
        Update: Partial<Database["public"]["Tables"]["reminders"]["Insert"]>;
        Relationships: [];
      };
      todos: {
        Row: {
          assignee_member_id: string | null;
          completed_at: string | null;
          completed_by: string | null;
          created_at: string;
          created_by: string | null;
          due_date: string | null;
          family_id: string;
          id: string;
          notes: string;
          position: string;
          status: string;
          title: string;
          updated_at: string;
        };
        Insert: {
          assignee_member_id?: string | null;
          completed_at?: string | null;
          completed_by?: string | null;
          created_at?: string;
          created_by?: string | null;
          due_date?: string | null;
          family_id: string;
          id?: string;
          notes?: string;
          position: string;
          status?: string;
          title: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["todos"]["Insert"]>;
        Relationships: [];
      };
      worker_heartbeats: {
        Row: {
          beat_at: string;
          name: string;
          version: string;
        };
        Insert: {
          beat_at: string;
          name: string;
          version: string;
        };
        Update: Partial<Database["public"]["Tables"]["worker_heartbeats"]["Insert"]>;
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
      authenticate_mcp_token: {
        Args: { p_token_hash: string };
        Returns: {
          email: string | null;
          status: string;
          token_id: string | null;
          user_id: string | null;
        }[];
      };
      calendar_feed: {
        Args: { p_token_hash: string };
        Returns: Json | null;
      };
      claim_due_calendar_events: {
        Args: { p_batch: number };
        Returns: {
          all_day: boolean;
          attendee_user_ids: string[];
          ends_at: string;
          family_id: string;
          id: string;
          location: string;
          notify_at: string;
          series_id: string;
          starts_at: string;
          timezone: string;
          title: string;
        }[];
      };
      claim_due_reminders: {
        Args: { p_batch: number };
        Returns: Database["public"]["Tables"]["reminders"]["Row"][];
      };
      claim_notifications: {
        Args: { p_batch: number };
        Returns: Database["public"]["Tables"]["notifications"]["Row"][];
      };
      complete_password_change: {
        Args: never;
        Returns: undefined;
      };
      confirm_import_batch: {
        Args: { p_batch_id: string; p_rows: Json };
        Returns: {
          amount: number;
          category: string;
          description: string;
          expense_date: string;
          id: string;
          notes: string | null;
          subtype: string | null;
        }[];
      };
      create_calendar_events: {
        Args: { p_member_ids: string[]; p_rows: Json };
        Returns: Database["public"]["Tables"]["calendar_events"]["Row"][];
      };
      create_calendar_feed: {
        Args: { p_token_hash: string };
        Returns: {
          created_at: string;
          id: string;
          last_fetched_at: string | null;
          revoked_at: string | null;
          user_id: string;
        }[];
      };
      create_family: {
        Args: {
          p_name: string;
        };
        Returns: string;
      };
      create_family_invite: {
        Args: {
          p_code_hash: string;
          p_permissions: Json | null;
          p_role: string;
        };
        Returns: {
          expires_at: string;
          invite_id: string;
        }[];
      };
      create_import_batch: {
        Args: { p_batch: Json; p_rows: Json };
        Returns: string;
      };
      create_mcp_token: {
        Args: {
          p_expiry: string;
          p_name: string;
          p_prefix: string;
          p_token_hash: string;
        };
        Returns: {
          created_at: string;
          expires_at: string | null;
          id: string;
          last_used_at: string | null;
          name: string;
          prefix: string;
          regenerated_at: string | null;
          revoked_at: string | null;
          user_id: string;
        }[];
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
      list_family_invites: {
        Args: never;
        Returns: {
          created_at: string;
          created_by_name: string | null;
          expires_at: string;
          invite_id: string;
          permissions: Json | null;
          role: string;
        }[];
      };
      my_mcp_access: {
        Args: never;
        Returns: Json;
      };
      preview_family_invite: {
        Args: { p_code_hash: string };
        Returns: {
          expires_at: string;
          family_name: string;
          inviter_name: string | null;
          permissions: Json | null;
          role: string;
        }[];
      };
      purge_expired_import_batches: {
        Args: never;
        Returns: number;
      };
      redeem_family_invite: {
        Args: { p_code_hash: string };
        Returns: string;
      };
      regenerate_mcp_token: {
        Args: {
          p_expiry: string;
          p_id: string;
          p_prefix: string;
          p_token_hash: string;
        };
        Returns: {
          created_at: string;
          expires_at: string | null;
          id: string;
          last_used_at: string | null;
          name: string;
          prefix: string;
          regenerated_at: string | null;
          revoked_at: string | null;
          user_id: string;
        }[];
      };
      register_push_subscription: {
        Args: {
          p_auth: string;
          p_endpoint: string;
          p_p256dh: string;
          p_user_agent?: string;
        };
        Returns: Database["public"]["Tables"]["push_subscriptions"]["Row"];
      };
      remove_family_member: {
        Args: { p_member_id: string };
        Returns: undefined;
      };
      require_password_change: {
        Args: { p_member_id: string };
        Returns: string;
      };
      revoke_calendar_feed: {
        Args: never;
        Returns: boolean;
      };
      revoke_family_invite: {
        Args: { p_invite_id: string };
        Returns: undefined;
      };
      revoke_mcp_token: {
        Args: { p_id: string };
        Returns: boolean;
      };
      send_test_notification: {
        Args: never;
        Returns: boolean;
      };
      set_member_color: {
        Args: {
          p_member_id: string;
          p_color: number | null;
        };
        Returns: undefined;
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
      undo_import_batch: {
        Args: { p_batch_id: string };
        Returns: number;
      };
      update_calendar_events: {
        Args: { p_member_ids: string[] | null; p_rows: Json };
        Returns: Database["public"]["Tables"]["calendar_events"]["Row"][];
      };
    };
    Enums: { Role: "USER" | "ADMIN" };
    CompositeTypes: { [_ in never]: never };
  };
};
