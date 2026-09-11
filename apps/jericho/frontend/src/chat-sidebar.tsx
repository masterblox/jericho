import type {
  CommandCenterMission,
  CommandCenterOutcome,
  KnowledgePackage,
} from '@jericho/shared';

import type { ConversationListItem } from './chat-history';
import type { CoreUsageMeter } from './chat-usage';

export type SidebarSection = 'chats' | 'projects' | 'artifacts' | 'images';

export function ChatSidebar({
  collapsed,
  section,
  conversations,
  activeConversationId,
  missions,
  outcomes,
  packages,
  artifactCount,
  imageCount,
  usage,
  operatorLabel,
  operatorMeta,
  theme,
  userMenuOpen,
  onToggle,
  onNewChat,
  onSelectConversation,
  onSection,
  onToggleUserMenu,
  onToggleTheme,
}: {
  collapsed: boolean;
  section: SidebarSection;
  conversations: ConversationListItem[];
  activeConversationId: string;
  missions: CommandCenterMission[];
  outcomes: CommandCenterOutcome[];
  packages: KnowledgePackage[];
  artifactCount: number;
  imageCount: number;
  usage: CoreUsageMeter;
  operatorLabel: string;
  operatorMeta: string;
  theme: 'light' | 'dark';
  userMenuOpen: boolean;
  onToggle: () => void;
  onNewChat: () => void;
  onSelectConversation: (id: string) => void;
  onSection: (section: SidebarSection) => void;
  onToggleUserMenu: () => void;
  onToggleTheme: () => void;
}) {
  return (
    <aside
      className="jericho-sidebar cn-card"
      data-collapsed={collapsed ? 'true' : 'false'}
      aria-label="Workspace"
    >
      <div className="jericho-sidebar__brand">
        <button
          type="button"
          data-gesture-target="sidebar:toggle"
          aria-pressed={collapsed}
          aria-label="Toggle sidebar"
          onClick={onToggle}
        >
          {collapsed ? 'Open' : 'Hide'}
        </button>
        {!collapsed && <strong>Jericho</strong>}
      </div>

      <button
        type="button"
        className="jericho-sidebar__new"
        data-gesture-target="chat:new"
        onClick={onNewChat}
      >
        New chat
      </button>

      <nav className="jericho-sidebar__nav" aria-label="Library">
        <SidebarNavButton
          id="chats"
          label="Chats"
          count={conversations.length}
          active={section === 'chats'}
          collapsed={collapsed}
          onSelect={onSection}
        />
        <SidebarNavButton
          id="projects"
          label="Projects"
          count={missions.length}
          active={section === 'projects'}
          collapsed={collapsed}
          onSelect={onSection}
        />
        <SidebarNavButton
          id="artifacts"
          label="Artifacts"
          count={artifactCount}
          active={section === 'artifacts'}
          collapsed={collapsed}
          onSelect={onSection}
        />
        <SidebarNavButton
          id="images"
          label="Images"
          count={imageCount}
          active={section === 'images'}
          collapsed={collapsed}
          onSelect={onSection}
        />
      </nav>

      {!collapsed && (
        <div className="jericho-sidebar__list" aria-live="polite">
          {section === 'chats' && (
            <ul aria-label="Conversation list">
              {conversations.length === 0 && (
                <li className="jericho-sidebar__empty">No chats in Core yet</li>
              )}
              {conversations.map((conversation) => (
                <li key={conversation.id}>
                  <button
                    type="button"
                    data-gesture-target={`conversation:${conversation.id}`}
                    aria-current={conversation.id === activeConversationId ? 'true' : undefined}
                    onClick={() => onSelectConversation(conversation.id)}
                  >
                    <span>{conversation.preview}</span>
                    <time dateTime={conversation.at}>{formatListTime(conversation.at)}</time>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {section === 'projects' && (
            <ul aria-label="Projects">
              {missions.length === 0 && <li className="jericho-sidebar__empty">No missions in Core</li>}
              {missions.map((mission) => (
                <li key={mission.id}>
                  <p data-gesture-target={`mission:${mission.id}`}>
                    <strong>{mission.title}</strong>
                    <span>{mission.status.replaceAll('_', ' ')}</span>
                  </p>
                </li>
              ))}
            </ul>
          )}
          {section === 'artifacts' && (
            <ul aria-label="Artifacts">
              {packages.length === 0 && outcomes.length === 0 && (
                <li className="jericho-sidebar__empty">No verified artifacts</li>
              )}
              {packages.map((pack) => (
                <li key={pack.id}>
                  <p data-gesture-target={`package:${pack.id}`}>
                    <strong>{pack.title}</strong>
                    <span>knowledge package</span>
                  </p>
                </li>
              ))}
              {outcomes.map((outcome) => (
                <li key={outcome.id}>
                  <p data-gesture-target={`outcome:${outcome.id}`}>
                    <strong>{outcome.missionId}</strong>
                    <span>{outcome.verified ? 'verified' : String(outcome.status).replaceAll('_', ' ')}</span>
                  </p>
                </li>
              ))}
            </ul>
          )}
          {section === 'images' && (
            <ul aria-label="Images">
              <li className="jericho-sidebar__empty">
                {imageCount === 0 ? 'No images in Core' : `${imageCount} Core projections`}
              </li>
            </ul>
          )}
        </div>
      )}

      <div className="jericho-usage-meter cn-card" data-gesture-target="usage:meter">
        <p className="jericho-eyebrow">Core usage</p>
        <p aria-label="Core usage">
          <strong>{usage.spentLabel}</strong>
          <span> / {usage.capLabel}</span>
        </p>
        <div
          className="jericho-usage-meter__bar"
          role="meter"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(usage.ratio * 100)}
          aria-label="Mission budget used"
        >
          <span style={{ width: `${Math.round(usage.ratio * 100)}%` }} />
        </div>
        <p className="jericho-usage-meter__connectors">{usage.connectorLabel}</p>
      </div>

      <div className="jericho-user-menu">
        <button
          type="button"
          data-gesture-target="user:menu"
          aria-expanded={userMenuOpen}
          aria-haspopup="menu"
          onClick={onToggleUserMenu}
        >
          <span>{operatorLabel}</span>
          {!collapsed && <small>{operatorMeta}</small>}
        </button>
        {userMenuOpen && (
          <div className="jericho-user-menu__panel cn-card" role="menu">
            <button type="button" role="menuitem" data-gesture-target="theme:toggle" onClick={onToggleTheme}>
              {theme === 'dark' ? 'Light theme' : 'Dark theme'}
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}

function SidebarNavButton({
  id,
  label,
  count,
  active,
  collapsed,
  onSelect,
}: {
  id: SidebarSection;
  label: string;
  count: number;
  active: boolean;
  collapsed: boolean;
  onSelect: (section: SidebarSection) => void;
}) {
  return (
    <button
      type="button"
      data-gesture-target={`nav:${id}`}
      aria-current={active ? 'page' : undefined}
      aria-label={collapsed ? `${label} (${count})` : undefined}
      onClick={() => onSelect(id)}
    >
      <span>{label}</span>
      {!collapsed && <span>{count}</span>}
    </button>
  );
}

function formatListTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('en-GB', { hour12: false, hour: '2-digit', minute: '2-digit' });
}
