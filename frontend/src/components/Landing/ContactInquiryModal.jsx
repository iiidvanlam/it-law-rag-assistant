import React, { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { AlertTriangle, CheckCircle2, Loader2, MessageSquare, Send, X } from 'lucide-react';

export function ContactInquiryModal({
  isOpen,
  onClose,
  apiBaseUrl,
  apiHeaders,
  currentUser,
}) {
  const [fullName, setFullName] = useState(currentUser?.full_name || '');
  const [email, setEmail] = useState(currentUser?.email || '');
  const [phone, setPhone] = useState('');
  const [organization, setOrganization] = useState(currentUser?.organization || '');
  const [topic, setTopic] = useState('Hỗ trợ pháp lý CNTT');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const closeRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return undefined;
    closeRef.current?.focus?.();
    const onKey = (e) => {
      if (e.key === 'Escape' && !loading) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, loading, onClose]);

  if (!isOpen) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg('');
    setSuccessMsg('');
    try {
      const res = await axios.post(
        `${apiBaseUrl}/support/contact`,
        {
          full_name: fullName.trim(),
          email: email.trim(),
          phone: phone.trim(),
          organization: organization.trim(),
          topic,
          message: message.trim(),
        },
        { headers: apiHeaders }
      );
      setSuccessMsg(res.data?.message || 'Đã gửi yêu cầu hỗ trợ thành công.');
      setMessage('');
    } catch (err) {
      setErrorMsg(
        err?.response?.data?.detail || 'Không thể gửi yêu cầu. Vui lòng kiểm tra thông tin.'
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="lx-contact-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="lx-contact-title"
      onClick={() => !loading && onClose()}
    >
      <div className="lx-contact-card" onClick={(e) => e.stopPropagation()}>
        <div className="lx-contact-header">
          <div className="lx-contact-title-wrap">
            <span className="lx-contact-icon" aria-hidden="true">
              <MessageSquare size={18} />
            </span>
            <div>
              <h2 id="lx-contact-title">Liên hệ & Hỗ trợ LexIT</h2>
              <p>Gửi câu hỏi triển khai, góp ý dữ liệu văn bản luật hoặc phản hồi kỹ thuật</p>
            </div>
          </div>
          <button
            ref={closeRef}
            type="button"
            className="lexit-auth-close-btn"
            style={{ position: 'static', transform: 'none' }}
            onClick={onClose}
            aria-label="Đóng hộp thoại liên hệ"
            disabled={loading}
          >
            <X size={18} />
          </button>
        </div>

        {errorMsg && (
          <div className="lexit-auth-alert error" role="alert">
            <AlertTriangle size={16} aria-hidden="true" />
            <span>{errorMsg}</span>
          </div>
        )}
        {successMsg && (
          <div className="lexit-auth-alert success" role="status">
            <CheckCircle2 size={16} aria-hidden="true" />
            <span>{successMsg}</span>
          </div>
        )}

        <form className="lexit-auth-form" onSubmit={handleSubmit}>
          <div className="lexit-auth-grid-2">
            <div className="lexit-auth-field">
              <label htmlFor="lx-inq-name" className="lexit-auth-label">Họ và tên *</label>
              <input
                id="lx-inq-name"
                type="text"
                className="lexit-auth-input"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Nguyễn Văn A"
                required
                disabled={loading}
              />
            </div>
            <div className="lexit-auth-field">
              <label htmlFor="lx-inq-email" className="lexit-auth-label">Email *</label>
              <input
                id="lx-inq-email"
                type="email"
                className="lexit-auth-input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="ban@congty.vn"
                required
                disabled={loading}
              />
            </div>
          </div>

          <div className="lexit-auth-grid-2">
            <div className="lexit-auth-field">
              <label htmlFor="lx-inq-phone" className="lexit-auth-label">Số điện thoại</label>
              <input
                id="lx-inq-phone"
                type="tel"
                className="lexit-auth-input"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="09xx xxx xxx"
                disabled={loading}
              />
            </div>
            <div className="lexit-auth-field">
              <label htmlFor="lx-inq-topic" className="lexit-auth-label">Chủ đề</label>
              <select
                id="lx-inq-topic"
                className="lexit-auth-input lexit-auth-select"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                disabled={loading}
              >
                <option value="Hỗ trợ pháp lý CNTT">Hỗ trợ pháp lý CNTT</option>
                <option value="Bổ sung văn bản quy phạm">Bổ sung văn bản quy phạm</option>
                <option value="Triển khai nội bộ doanh nghiệp">Triển khai nội bộ doanh nghiệp</option>
                <option value="Báo lỗi kỹ thuật">Báo lỗi kỹ thuật</option>
              </select>
            </div>
          </div>

          <div className="lexit-auth-field">
            <label htmlFor="lx-inq-org" className="lexit-auth-label">Đơn vị / Doanh nghiệp</label>
            <input
              id="lx-inq-org"
              type="text"
              className="lexit-auth-input"
              value={organization}
              onChange={(e) => setOrganization(e.target.value)}
              placeholder="Tên công ty hoặc tổ chức (tuỳ chọn)"
              disabled={loading}
            />
          </div>

          <div className="lexit-auth-field">
            <label htmlFor="lx-inq-msg" className="lexit-auth-label">Nội dung cần hỗ trợ *</label>
            <textarea
              id="lx-inq-msg"
              rows={4}
              className="lexit-auth-input"
              style={{ minHeight: '6rem', resize: 'vertical' }}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Mô tả chi tiết yêu cầu của bạn (tối thiểu 10 ký tự)..."
              required
              minLength={10}
              disabled={loading}
            />
          </div>

          <button type="submit" className="lexit-auth-submit-btn ready" disabled={loading}>
            {loading ? <Loader2 size={16} className="spin-icon" /> : <Send size={15} />}
            <span>{loading ? 'Đang gửi yêu cầu...' : 'Gửi yêu cầu hỗ trợ'}</span>
          </button>
        </form>
      </div>
    </div>
  );
}
