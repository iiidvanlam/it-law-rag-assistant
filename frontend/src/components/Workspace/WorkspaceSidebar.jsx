import React, { useEffect, useRef, useState } from 'react';
import {
  BarChart3,
  Bell,
  BookOpen,
  ChevronLeft,
  Clock,
  FileSignature,
  Gavel,
  Home,
  KeyRound,
  LogOut,
  Mail,
  MessageSquare,
  Pencil,
  Pin,
  Scale,
  Search,
  Settings,
  Shield,
  Sparkles,
  Trash2,
  User,
} from 'lucide-react';
import { UserAvatar } from '../../LegalWorkspaceModals';

export function WorkspaceSidebar({
  sidebarOpen,
  onCloseSidebar,
  activePage,
  currentUser,
  backendStatus,
  conversations,
  activeConvId,
  historySearch,
  onHistorySearchChange,
  renamingConvId,
  renameDraft,
  onRenameDraftChange,
  onStartRename,
  onCommitRename,
  onCancelRename,
  onSelectConversation,
  onTogglePin,
  onDeleteConversation,
  onNewChat,
  onNavigate,
  onOpenDrafting,
  onOpenCompliance,
  onOpenBenchmark,
  onLogout,
}) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsRef = useRef(null);

  useEffect(() => {
    if (!settingsOpen) return undefined;
    const onOutside = (e) => {
      if (settingsRef.current && !settingsRef.current.contains(e.target)) {
        setSettingsOpen(false);
      }
    };
    const onEsc = (e) => {
      if (e.key === 'Escape') setSettingsOpen(false);
    };
    window.addEventListener('mousedown', onOutside);
    window.addEventListener('keydown', onEsc);
    return () => {
      window.removeEventListener('mousedown', onOutside);
      window.removeEventListener('keydown', onEsc);
    };
  }, [settingsOpen]);

  const filteredConversations = conversations
    .filter((c) => {
      const q = historySearch.trim().toLowerCase();
      if (!q) return true;
      return (c.title || '').toLowerCase().includes(q);
    })
    .slice()
    .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || (b.updatedAt || 0) - (a.updatedAt || 0));

  const hasSavedHistory = filteredConversations.some((c) => (c.messages?.length || 0) > 0);

  return (
    <aside
      className={`lx-ws-sidebar ${sidebarOpen ? 'open' : 'collapsed'}`}
      aria-label="Điều hướng không gian làm việc LexIT"
    >
      {/* Top Brand + Collapse */}
      <div className="lx-ws-brand-row">
        <a
          href="/home"
          className="lx-brand-logo"
          onClick={(e) => {
            e.preventDefault();
            onNavigate('/home');
          }}
          aria-label="Về trang chủ LexIT"
        >
          <span className="lx-brand-emblem" aria-hidden="true">
            <Scale size={16} strokeWidth={2.3} />
          </span>
          <span className="lx-brand-word" style={{ fontSize: '1.35rem' }}>
            <strong>LEX</strong>
            <span>IT</span>
          </span>
        </a>
        <button
          type="button"
          className="lx-ws-collapse-btn"
          onClick={onCloseSidebar}
          title="Thu gọn thanh bên"
          aria-label="Thu gọn thanh bên"
        >
          <ChevronLeft size={16} />
        </button>
      </div>

      {/* Blue Gradient Account Status Card */}
      <div className="lx-ws-account-card">
        <div className="lx-ws-account-left">
          <UserAvatar user={currentUser} className="lx-ws-avatar-sm" />
          <div className="lx-ws-account-meta">
            <strong>{currentUser?.full_name || 'Thành viên LexIT'}</strong>
            <span>
              <i className={`lx-ws-dot ${backendStatus?.pgvector ? 'online' : 'offline'}`} />
              {backendStatus?.pgvector ? 'PGVector Sẵn sàng' : 'Đang đồng bộ DB'}
            </span>
          </div>
        </div>
        <button
          type="button"
          className="lx-ws-profile-link"
          onClick={() => onNavigate('/profile/info')}
        >
          Hồ sơ
        </button>
      </div>

      {/* Outlined Primary Workspace Action */}
      <button
        type="button"
        className={`lx-ws-primary-chat-btn ${activePage === 'chat' ? 'active' : ''}`}
        onClick={() => {
          onNewChat();
          onNavigate('/assistant/lexit/new');
        }}
      >
        <Sparkles size={15} aria-hidden="true" />
        <span>Trợ lý LexIT</span>
      </button>

      {/* Featured Modules */}
      <div className="lx-ws-nav-section">
        <div className="lx-ws-section-label">Tính năng nổi bật</div>
        <nav className="lx-ws-nav-list" aria-label="Công cụ pháp lý">
          <button type="button" className="lx-ws-nav-item" onClick={onOpenDrafting}>
            <FileSignature size={16} aria-hidden="true" />
            <span>Soạn thảo</span>
          </button>
          <button type="button" className="lx-ws-nav-item" onClick={onOpenCompliance}>
            <Shield size={16} aria-hidden="true" />
            <span>Rà soát</span>
          </button>
          <button
            type="button"
            className={`lx-ws-nav-item ${activePage === 'legal-document' ? 'active' : ''}`}
            onClick={() => onNavigate('/assistant/legal-document')}
          >
            <BookOpen size={16} aria-hidden="true" />
            <span>Tra cứu văn bản pháp luật</span>
          </button>
          <button
            type="button"
            className={`lx-ws-nav-item ${activePage === 'judgement' ? 'active' : ''}`}
            onClick={() => onNavigate('/assistant/judgement')}
          >
            <Gavel size={16} aria-hidden="true" />
            <span>Tra cứu bản án/án lệ</span>
          </button>
          <button
            type="button"
            className={`lx-ws-nav-item ${activePage === 'legal-update' ? 'active' : ''}`}
            onClick={() => onNavigate('/assistant/legal-update')}
          >
            <Bell size={16} aria-hidden="true" />
            <span>Cập nhật pháp lý</span>
          </button>
        </nav>
      </div>

      {/* Session History */}
      <div className="lx-ws-history-section">
        <div className="lx-ws-section-label">Lịch sử</div>
        <div className="lx-ws-history-search">
          <Search size={13} aria-hidden="true" />
          <input
            type="text"
            value={historySearch}
            onChange={(e) => onHistorySearchChange(e.target.value)}
            placeholder="Tìm phiên làm việc..."
            aria-label="Tìm kiếm lịch sử hội thoại"
          />
        </div>

        <div className="lx-ws-history-scroll">
          {!hasSavedHistory && !historySearch.trim() ? (
            <div className="lx-ws-empty-history">
              <MessageSquare size={22} aria-hidden="true" />
              <strong>Chưa có phiên làm việc nào</strong>
              <span>Bắt đầu trò chuyện với LexIT!</span>
            </div>
          ) : filteredConversations.length === 0 ? (
            <div className="lx-ws-empty-history">
              <strong>Không tìm thấy kết quả</strong>
              <span>Thử từ khóa khác</span>
            </div>
          ) : (
            <div className="lx-ws-history-list">
              {filteredConversations.map((conv) => (
                <div
                  key={conv.id}
                  className={`lx-ws-conv-row ${
                    activePage === 'chat' && conv.id === activeConvId ? 'active' : ''
                  }`}
                >
                  {renamingConvId === conv.id ? (
                    <input
                      type="text"
                      className="lx-ws-rename-input"
                      value={renameDraft}
                      onChange={(e) => onRenameDraftChange(e.target.value)}
                      onBlur={() => onCommitRename(conv.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') onCommitRename(conv.id);
                        if (e.key === 'Escape') onCancelRename();
                      }}
                      autoFocus
                      aria-label="Đổi tên phiên hội thoại"
                    />
                  ) : (
                    <>
                      <button
                        type="button"
                        className="lx-ws-conv-btn"
                        onClick={() => {
                          onSelectConversation(conv.id);
                          if (activePage !== 'chat') {
                            onNavigate('/assistant/lexit/new');
                          }
                        }}
                      >
                        {conv.pinned ? (
                          <Pin size={12} className="pin-accent" aria-hidden="true" />
                        ) : (
                          <MessageSquare size={13} aria-hidden="true" />
                        )}
                        <span className="lx-ws-conv-title">{conv.title}</span>
                      </button>
                      <div className="lx-ws-conv-actions">
                        <button
                          type="button"
                          onClick={(e) => onTogglePin(e, conv.id)}
                          aria-label={conv.pinned ? 'Bỏ ghim hội thoại' : 'Ghim hội thoại'}
                          title={conv.pinned ? 'Bỏ ghim' : 'Ghim'}
                        >
                          <Pin size={12} />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => onStartRename(e, conv)}
                          aria-label="Đổi tên hội thoại"
                          title="Đổi tên"
                        >
                          <Pencil size={12} />
                        </button>
                        <button
                          type="button"
                          className="danger"
                          onClick={(e) => onDeleteConversation(e, conv.id)}
                          aria-label="Xóa hội thoại"
                          title="Xóa"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Bottom Pinned Settings Popover */}
      <div className="lx-ws-footer" ref={settingsRef}>
        {settingsOpen && (
          <div className="lx-ws-settings-popover" role="menu" aria-label="Menu cài đặt">
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setSettingsOpen(false);
                onNavigate('/profile/receive-newsletters');
              }}
            >
              <Mail size={15} />
              <span>Nhận bản tin pháp lý</span>
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setSettingsOpen(false);
                onNavigate('/profile/info');
              }}
            >
              <User size={15} />
              <span>Hồ sơ cá nhân</span>
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setSettingsOpen(false);
                onNavigate('/profile/change-password');
              }}
            >
              <KeyRound size={15} />
              <span>Đổi mật khẩu</span>
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setSettingsOpen(false);
                onNavigate('/profile/sessions');
              }}
            >
              <Clock size={15} />
              <span>Lịch sử hoạt động</span>
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setSettingsOpen(false);
                onOpenBenchmark();
              }}
            >
              <BarChart3 size={15} />
              <span>Kiểm chứng 40 ca</span>
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setSettingsOpen(false);
                onNavigate('/home');
              }}
            >
              <Home size={15} />
              <span>Trang chủ LexIT</span>
            </button>
            <button
              type="button"
              role="menuitem"
              className="danger"
              onClick={() => {
                setSettingsOpen(false);
                onLogout();
              }}
            >
              <LogOut size={15} />
              <span>Đăng xuất</span>
            </button>
          </div>
        )}

        <button
          type="button"
          className="lx-ws-settings-btn"
          onClick={() => setSettingsOpen((prev) => !prev)}
          aria-expanded={settingsOpen}
        >
          <Settings size={16} aria-hidden="true" />
          <span>Cài đặt</span>
        </button>
      </div>
    </aside>
  );
}
