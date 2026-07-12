import React from 'react';
import { Card } from './ui';

const GlassCard = ({ children, className }) => {
  return (
    <Card className={`admin-section ${className || ''}`}>
      {children}
    </Card>
  );
};

export default GlassCard;
