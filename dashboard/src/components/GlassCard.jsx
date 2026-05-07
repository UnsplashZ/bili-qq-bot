import React from 'react';
import { Card } from './ui';

const GlassCard = ({ children, className }) => {
  return (
    <Card className={className}>
      {children}
    </Card>
  );
};

export default GlassCard;
